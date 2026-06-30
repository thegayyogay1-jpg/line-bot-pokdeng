const express = require('express');
const app = express();
app.use(express.json());

// ฐานข้อมูลจำลอง (จำในแรม)
let usersWallets = {}; // { userId: { memberNumber: 1, memberTitle: "สมาชิกที่ 1", name: "ชื่อ LINE", balance: 0 } }
let nextMemberId = 1;  // ตัวนับลำดับสมาชิก 1, 2, 3...
let isRoundOpen = false;
let roundBets = {}; 
let withdrawQueue = []; 

// 👑 [ตั้งค่าแอดมิน] ใส่ LINE USER ID ของแอดมินตรงนี้ครับ
const ADMIN_LIST = [
    "U0d1e353091d90af57b37ff38d36e29bc",
    "ใส่_LINE_USER_ID_แอดมินคนที่สองตรงนี้ (ถ้ามี)"
]; 

function parseCard(cardStr) {
    if (!cardStr) return { score: 0, deng: 1 };
    let str = cardStr.trim().toLowerCase();
    let isDeng = false;
    if (str.startsWith('d')) {
        isDeng = true;
        str = str.substring(1);
    }
    const specialChars = ['t', 'j', 'q', 'k'];
    if (str.length === 2 && specialChars.includes(str[0]) && specialChars.includes(str[1])) {
        return { score: 7.5, deng: isDeng ? 2 : 1 };
    }
    const getVal = (c) => specialChars.includes(c) ? 0 : parseInt(c);
    if (str.length === 2) {
        let score = (getVal(str[0]) + getVal(str[1])) % 10;
        return { score: score, deng: isDeng ? 2 : 1 };
    }
    return { score: 0, deng: 1 };
}

app.post('/callback', async (req, res) => {
    const events = req.body.events;
    if (!events) return res.sendStatus(200);

    for (let event of events) {
        if (event.type === 'message' && event.message.type === 'text') {
            const replyToken = event.replyToken;
            const userId = event.source.userId;
            const originalMsg = event.message.text.trim();
            const userMsg = originalMsg.toLowerCase().replace(/\s+/g, '');
            let replyMsg = "";

            // ตรวจสอบสิทธิ์แอดมิน
            const isAdmin = ADMIN_LIST.includes(userId);

            // 🧽 [คำสั่งพิเศษแอดมิน] ล้างระบบสมาชิกทั้งหมด เริ่มต้นใหม่
            if (userMsg === 'ล้างระบบ') {
                if (!isAdmin) {
                    replyMsg = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งล้างระบบครับ!";
                } else {
                    usersWallets = {};
                    nextMemberId = 1;
                    isRoundOpen = false;
                    roundBets = {};
                    withdrawQueue = [];
                    replyMsg = "👑 [แอดมิน] ♻️ ล้างระบบสมาชิกและข้อมูลทั้งหมดเรียบร้อยแล้วครับ! ตอนนี้ระบบว่างเปล่า ให้ทุกคนพิมพ์ทักบอทเพื่อเริ่มรันหมายเลข สมาชิกที่ 1 ใหม่ได้เลยครับ";
                }
            }

            // ลงทะเบียนสมาชิกใหม่เข้าคิวอัตโนมัติ (ถ้ายังไม่มีในระบบ)
            else {
                if (!usersWallets[userId]) {
                    let displayName = "ผู้เล่นทั่วไป";
                    try {
                        const profileRes = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
                            headers: { 'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` }
                        });
                        const profile = await profileRes.json();
                        if (profile.displayName) displayName = profile.displayName;
                    } catch (e) {
                        console.error("ดึงโปรไฟล์ไลน์ล้มเหลว:", e);
                    }
                    
                    usersWallets[userId] = { 
                        memberNumber: nextMemberId,
                        memberTitle: `สมาชิกที่ ${nextMemberId}`,
                        name: displayName, 
                        balance: 0 
                    };
                    nextMemberId++;
                }
                
                const user = usersWallets[userId];
                const mentionText = `👤 ${user.memberTitle} (${user.name}) `;
                
                const getQueueIndex = (uid) => withdrawQueue.findIndex(item => item.userId === uid) + 1;
                const hasPendingWithdraw = getQueueIndex(userId) > 0;

                // คำสั่งช่วยเหลือ
                if (userMsg === 'คำสั่ง' || userMsg === 'help') {
                    replyMsg = `📖 [คู่มือคีย์ลัดระบบป๊อกเด้ง]\n` +
                               `------------------------\n` +
                               `📌 **สำหรับผู้เล่นทั่วไป:**\n` +
                               `• พิมพ์ [C] : เช็คเงินกระเป๋าและรหัสสมาชิก\n` +
                               `• พิมพ์ [ถอน จำนวนเงิน] : แจ้งถอนเงินคิว\n` +
                               `• พิมพ์ [R] : ยกเลิกโพยประจำรอบ\n` +
                               `• ส่งโพยแทง : [ขา]-[ราคา] (เช่น 123-50)\n\n` +
                               `👑 **สำหรับแอดมินเท่านั้น:**\n` +
                               `• พิมพ์ [เติม สมาชิกที่X จำนวนเงิน] หรือกดแท็กชื่อ : เติมเงิน\n` +
                               `• พิมพ์ [Y สมาชิกที่X] หรือกดแท็กชื่อ : อนุมัติคิวถอนเงิน\n` +
                               `• พิมพ์ [O] : เปิดรอบ / [X] : ปิดรอบสรุปโพย\n` +
                               `• พิมพ์ [ผล: ไพ่ขา1...,ไพ่เจ้ามือ] : คิดเงินรอบ\n` +
                               `• พิมพ์ [ล้างระบบ] : ลบฐานข้อมูลสมาชิกทั้งหมดกลับไปเริ่มนับ 1 ใหม่`;
                }

                // ==========================================
                // PART 1: ระบบเติมเงิน / ถอนเงิน / คอนเฟิร์ม Y
                // ==========================================
                else if (originalMsg.startsWith('เติม')) {
                    if (!isAdmin) {
                        replyMsg = `${mentionText} ❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งเติมเงินครับ!`;
                    } else {
                        let targetUserId = null;
                        let amount = 0;

                        if (event.message.mention && event.message.mention.mentions && event.message.mention.mentions.length > 0) {
                            targetUserId = event.message.mention.mentions[0].userId;
                            let tokens = originalMsg.split(/\s+/);
                            amount = parseInt(tokens[tokens.length - 1]);
                        } 
                        else {
                            let cleanText = originalMsg.substring(4).trim();
                            let tokens = cleanText.split(/\s+/);
                            let searchKeyword = "";

                            if (originalMsg.includes('@') && !originalMsg.startsWith('เติม ')) {
                                let parts = originalMsg.replace('เติม', '').split(/\s+/);
                                if (parts.length >= 2) {
                                    searchKeyword = parts[0].replace('@', '').trim().toLowerCase();
                                    amount = parseInt(parts[parts.length - 1]);
                                }
                            } else if (tokens.length >= 2) {
                                searchKeyword = tokens[0].replace('@', '').trim().toLowerCase();
                                amount = parseInt(tokens[tokens.length - 1]);
                            }

                            if (searchKeyword) {
                                for (let uid in usersWallets) {
                                    let u = usersWallets[uid];
                                    if (u.name.toLowerCase().includes(searchKeyword) || 
                                        u.memberTitle.toLowerCase().replace(/\s+/g, '').includes(searchKeyword)) {
                                        targetUserId = uid;
                                        break;
                                    }
                                }
                            }
                        }

                        if (!targetUserId || isNaN(amount) || amount <= 0) {
                            replyMsg = `👑 [แอดมิน] ❌ ไม่พบผู้เล่น หรือรูปแบบจำนวนเงินไม่ถูกต้อง\n📌 แนะนำพิมพ์: **เติม สมาชิกที่1 ${amount || 1000}** หรือพิมพ์ **เติม ** ตามด้วยกดแท็กชื่อจริงไฮไลท์สีฟ้าในไลน์`;
                        } else {
                            if (event.message.mention && event.message.mention.mentions) {
                                let parts = originalMsg.split(/\s+/);
                                if(parts[1]) usersWallets[targetUserId].name = parts[1].replace('@', '');
                            }
                            
                            usersWallets[targetUserId].balance += amount;
                            let tUser = usersWallets[targetUserId];
                            replyMsg = `👑 [แอดมิน] ✅ เติมเงินสำเร็จ! +${amount} บาท\n👤 ${tUser.memberTitle} (@${tUser.name})\n💰 ยอดเงินคงเหลือปัจจุบัน: ${tUser.balance} บาท`;
                        }
                    }
                }
                else if (userMsg.startsWith('ถอน')) {
                    const qPos = getQueueIndex(userId);
                    if (qPos > 0) {
                        replyMsg = `${mentionText} ⚠️ รายการถอนเงินจำนวน ${withdrawQueue[qPos-1].amount} บาทของคุณ อยู่ระหว่างดำเนินการ (คิวที่ ${qPos})`;
                    } else {
                        const amount = parseInt(userMsg.replace('ถอน', ''));
                        if (!isNaN(amount) && amount > 0) {
                            if (user.balance < amount) {
                                replyMsg = `${mentionText} ❌ ไม่สามารถแจ้งถอนได้ ยอดเงินไม่พอ (มีอยู่ ${user.balance} บ.)`;
                            } else {
                                withdrawQueue.push({ userId: userId, amount: amount });
                                replyMsg = `${mentionText} 🔔 แจ้งถอนเงินจำนวน ${amount} บาท สำเร็จ!\n⏳ อยู่ใน **คิวที่ ${withdrawQueue.length}** ของระบบ`;
                            }
                        }
                    }
                }
                else if (originalMsg.startsWith('Y ') || originalMsg.startsWith('y ')) {
                    if (!isAdmin) {
                        replyMsg = `${mentionText} ❌ คุณไม่ใช่แอดมิน ไม่สามารถอนุมัติรายการถอนเงินได้ครับ`;
                    } else {
                        let targetUserId = null;

                        if (event.message.mention && event.message.mention.mentions && event.message.mention.mentions.length > 0) {
                            targetUserId = event.message.mention.mentions[0].userId;
                        } else {
                            const searchKeyword = originalMsg.substring(2).trim().replace('@', '').toLowerCase();
                            for (let uid in usersWallets) {
                                let u = usersWallets[uid];
                                if (u.name.toLowerCase().includes(searchKeyword) || 
                                    u.memberTitle.toLowerCase().replace(/\s+/g, '').includes(searchKeyword)) {
                                    targetUserId = uid;
                                    break;
                                }
                            }
                        }

                        let foundIndex = targetUserId ? withdrawQueue.findIndex(item => item.userId === targetUserId) : -1;

                        if (foundIndex === -1) {
                            replyMsg = `👑 [แอดมิน] ❌ ไม่พบรายการแจ้งถอนค้างของสมาชิกคนนี้ในคิว`;
                        } else {
                            const targetItem = withdrawQueue[foundIndex];
                            const targetUser = usersWallets[targetItem.userId];
                            
                            targetUser.balance -= targetItem.amount;
                            withdrawQueue.splice(foundIndex, 1);
                            
                            replyMsg = `👑 [แอดมิน] ✅ อนุมัติการถอนเงินเรียบร้อย!\n👤 ${targetUser.memberTitle} ถอนเงินสำเร็จ -${targetItem.amount} บาท`;
                        }
                    }
                }
                else if (userMsg === 'c') {
                    const qPos = getQueueIndex(userId);
                    if (qPos > 0) {
                        replyMsg = `${mentionText}\n💰 ยอดเงินคงเหลือของคุณ: ${user.balance} บาท\n⚠️ (มีรายการแจ้งถอนค้างอยู่ ${withdrawQueue[qPos-1].amount} บาท ในคิวที่ ${qPos})`;
                    } else {
                        replyMsg = `${mentionText}\n💰 ยอดเงินคงเหลือของคุณ: ${user.balance} บาท`;
                    }
                }

                // ==========================================
                // PART 2: ระบบเปิดรอบ (O) / ปิดรอบ (X) 
                // ==========================================
                else if (userMsg === 'o') {
                    if (!isAdmin) {
                        replyMsg = `${mentionText} ❌ คุณไม่ใช่แอดมิน ไม่สามารถเปิดรอบเดิมพันได้ครับ!`;
                    } else {
                        isRoundOpen = true;
                        roundBets = {}; 
                        replyMsg = "🟢 [ระบบ] แอดมินเปิดรับเดิมพันรอบใหม่แล้ว! ส่งโพยมาได้เลยครับ";
                    }
                }
                else if (userMsg === 'x') {
                    if (!isAdmin) {
                        replyMsg = `${mentionText} ❌ คุณไม่ใช่แอดมิน ไม่สามารถสั่งปิดรอบได้ครับ!`;
                    } else {
                        if (!isRoundOpen) {
                            replyMsg = "⚠️ รอบเดิมพันปิดอยู่แล้วครับ";
                        } else {
                            isRoundOpen = false;
                            let summary = "🔴 [ระบบ] แอดมินปิดรับเดิมพันรอบนี้แล้ว!\n📋 [สรุปโพยประจำรอบนี้]:\n";
                            let hasData = false;
                            for (let uid in roundBets) {
                                summary += `▪️ ${usersWallets[uid].memberTitle}: แทงรวม ${roundBets[uid].totalBet} บ. (ค้ำ ${roundBets[uid].holding} บ.)\n`;
                                hasData = true;
                            }
                            if (!hasData) summary += "❌ ไม่มีใครลงเดิมพันในรอบนี้\n";
                            replyMsg = summary + `\n⏳ รอแอดมินสรุปผลไพ่ โดยพิมพ์ 'ผล: [ไพ่ขา1],[ไพ่ขา2]...,[ไพ่เจ้ามือ]'`;
                        }
                    }
                }
                else if (userMsg === 'r') {
                    if (hasPendingWithdraw) {
                        replyMsg = `${mentionText} ❌ คุณมีรายการแจ้งถอนเงินตกค้างอยู่ ไม่สามารถร่วมทำรายการใดๆ ได้`;
                    } else if (!isRoundOpen) {
                        replyMsg = `${mentionText} ❌ ระบบปิดรอบไปแล้ว ไม่สามารถยกเลิกโพยได้ครับ`;
                    } else if (!roundBets[userId]) {
                        replyMsg = `${mentionText} ❌ คุณยังไม่มีโพยในรอบนี้ให้ยกเลิกครับ`;
                    } else {
                        const savedBet = roundBets[userId];
                        user.balance += savedBet.holding; 
                        delete roundBets[userId]; 
                        replyMsg = `${mentionText} 🔄 คืนโพยเรียบร้อยแล้วครับ! วงเงินค้ำประกัน ${savedBet.holding} บาท ถูกโอนกลับเข้ากระเป๋าคุณแล้ว\n💰 ยอดเงินคงเหลือปัจจุบัน: ${user.balance} บาท`;
                    }
                }

                // ==========================================
                // PART 3: ระบบส่งโพยแทงของผู้เล่น
                // ==========================================
                else if (userMsg.startsWith('มข-') || userMsg.startsWith('มจ-') || userMsg.startsWith('จ') || (userMsg.includes('-') && !userMsg.startsWith('ผล:'))) {
                    if (hasPendingWithdraw) {
                        const qPos = getQueueIndex(userId);
                        replyMsg = `${mentionText} ❌ **ไม่สามารถลงโพยได้!** มีรายการแจ้งถอนค้างอยู่ (คิวที่ ${qPos})`;
                    } 
                    else if (!isRoundOpen) {
                        replyMsg = `${mentionText} ❌ ยังไม่เปิดรอบ หรือระบบปิดรับเดิมพันไปแล้วครับ!`;
                    } 
                    else {
                        let betType = "", khas = [], betPerKha = 0, totalBet = 0, holding = 0;

                        if (userMsg.startsWith('มข-')) {
                            betPerKha = parseInt(userMsg.replace('มข-', ''));
                            if (!isNaN(betPerKha)) {
                                betType = "มข"; khas = [1,2,3,4,5,6,7]; totalBet = betPerKha * 7; holding = totalBet * 2;
                            }
                        }
                        else if (userMsg.startsWith('มจ-')) {
                            betPerKha = parseInt(userMsg.replace('มจ-', ''));
                            if (!isNaN(betPerKha)) {
                                betType = "มจ"; khas = [1,2,3,4,5,6,7]; totalBet = betPerKha * 7; holding = totalBet * 2;
                            }
                        }
                        else if (userMsg.startsWith('จ')) {
                            const parts = userMsg.substring(1).split('-');
                            if (parts.length === 2) {
                                khas = parts[0].split('').map(Number);
                                betPerKha = parseInt(parts[1]);
                                betType = "จ"; totalBet = betPerKha * khas.length; holding = totalBet * 2;
                            }
                        }
                        else if (userMsg.includes('-')) {
                            const parts = userMsg.split('-');
                            if (parts.length === 2 && !isNaN(parts[0])) {
                                khas = parts[0].split('').map(Number);
                                betPerKha = parseInt(parts[1]);
                                betType = "เดี่ยว"; totalBet = betPerKha * khas.length; holding = totalBet * 2;
                            }
                        }

                        if (holding > 0) {
                            if (roundBets[userId]) {
                                user.balance += roundBets[userId].holding;
                            }

                            if (user.balance < holding) {
                                replyMsg = `${mentionText} ❌ แทงไม่ได้ครับ! ยอดเงินคงเหลือ (${user.balance} บ.) ไม่พอกับค่าค้ำประกันที่ต้องใช้ (${holding} บ.)`;
                                if (roundBets[userId]) user.balance -= roundBets[userId].holding; 
                            } else {
                                user.balance -= holding; 
                                roundBets[userId] = { type: betType, khas: khas, betPerKha: betPerKha, totalBet: totalBet, holding: holding };
                                replyMsg = `${mentionText} 🎯 [จดโพยสำเร็จ]\n📝 โพย: ${originalMsg}\n🔒 หักเงินค้ำประกัน: ${holding} บาท\n💰 ยอดเงินคงเหลือหลังหักค้ำ: ${user.balance} บาท`;
                            }
                        }
                    }
                }

                // ==========================================
                // PART 4: ระบบคิดเงิน
                // ==========================================
                else if (originalMsg.startsWith('ผล:') || originalMsg.startsWith('ผล ')) {
                    if (!isAdmin) {
                        replyMsg = `${mentionText} ❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ส่งสรุปผลการแข่งขันครับ!`;
                    } else {
                        const resultStr = originalMsg.replace(/^ผล:\s*|^ผล\s+/i, '');
                        const results = resultStr.split(','); 
                        
                        if (results.length >= 2) {
                            let dealerRaw = results[results.length - 1];
                            let dealerResult = parseCard(dealerRaw);
                            
                            let summaryText = `📊 [สรุปผลคิดเงินป๊อกเด้ง]\n👑 เจ้ามือได้: ${dealerResult.score} แต้ม (${dealerResult.deng} เด้ง)\n------------------------\n`;
                            
                            for (let uid in roundBets) {
                                let savedBet = roundBets[uid];
                                let pUser = usersWallets[uid];
                                let userTotalReturn = 0; 

                                summaryText += `👤 ${pUser.memberTitle}:\n`;

                                savedBet.khas.forEach(khaNum => {
                                    let pRaw = results[khaNum - 1];
                                    let playerResult = parseCard(pRaw);
                                    let bet = savedBet.betPerKha;
                                    let isDealerSide = (savedBet.type === 'มจ' || savedBet.type === 'จ');

                                    let singleHolding = bet * 2; 
                                    let winLoss = 0;

                                    if (playerResult.score > dealerResult.score) {
                                        let winAmount = bet * playerResult.deng;
                                        winLoss = isDealerSide ? (-winAmount) : winAmount;
                                        userTotalReturn += isDealerSide ? 0 : (singleHolding + winAmount);
                                    } 
                                    else if (playerResult.score < dealerResult.score) {
                                        let loseAmount = bet * dealerResult.deng;
                                        if (isDealerSide) {
                                            let profit = loseAmount * 0.9; 
                                            winLoss = profit;
                                            userTotalReturn += (singleHolding + profit);
                                        } else {
                                            winLoss = -loseAmount;
                                            userTotalReturn += (singleHolding - loseAmount);
                                        }
                                    } 
                                    else {
                                        if (playerResult.deng > dealerResult.deng) {
                                            let winAmount = bet * (playerResult.deng - dealerResult.deng);
                                            winLoss = isDealerSide ? (-winAmount) : winAmount;
                                            userTotalReturn += isDealerSide ? 0 : (singleHolding + winAmount);
                                        } else if (playerResult.deng < dealerResult.deng) {
                                            let loseAmount = bet * (dealerResult.deng - playerResult.deng);
                                            if (isDealerSide) {
                                                let profit = loseAmount * 0.9;
                                                winLoss = profit; userTotalReturn += (singleHolding + profit);
                                            } else {
                                                winLoss = -loseAmount; userTotalReturn += (singleHolding - loseAmount);
                                            }
                                        } else {
                                            winLoss = 0; userTotalReturn += singleHolding; 
                                        }
                                    }

                                    let winLossSign = winLoss > 0 ? `+${winLoss}` : `${winLoss}`;
                                    summaryText += `  🔹 ขา ${khaNum} [${playerResult.score}แต้ม]: ${winLossSign} บาท\n`;
                                });

                                pUser.balance += userTotalReturn;
                                summaryText += `  💰 ยอดกระเป๋าล่าสุด: ${pUser.balance} บาท\n`;
                            }

                            replyMsg = summaryText + `\n✨ เคลียร์โพยประจำรอบเรียบร้อย พิมพ์ O เพื่อเริ่มรอบใหม่ครับ`;
                            roundBets = {}; 
                        }
                    }
                }
            }

            if (replyMsg) {
                try {
                    await fetch('https://api.line.me/v2/bot/message/reply', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
                        },
                        body: JSON.stringify({
                            replyToken: replyToken,
                            messages: [{ type: 'text', text: replyMsg }]
                        })
                    });
                } catch (err) {
                    console.error('Error:', err);
                }
            }
        }
    }
    res.sendStatus(200);
});

app.get('/', (req, res) => res.send('Bot is online!'));
app.listen(process.env.PORT || 3000);
