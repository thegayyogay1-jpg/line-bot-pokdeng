const express = require('express');
const app = express();
app.use(express.json());

// ฐานข้อมูลจำลอง (จำในแรม)
let usersWallets = {}; 
let nextMemberId = 1;  
let isRoundOpen = false;
let roundBets = {}; 
let withdrawQueue = []; 

// ✨ ตัวแปรระบบสำหรับพักข้อมูลผลไพ่เพื่อรอแอดมินคอนเฟิร์ม
let pendingResults = null; 

// 👑 [ตั้งค่าแอดมิน] ใส่ LINE USER ID ของแอดมินตรงนี้ครับ
const ADMIN_LIST = [
    "U0d1e353091d90af57b37ff38d36e29bc"
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

            const isAdmin = ADMIN_LIST.includes(userId);

            // 🧽 [คำสั่งแอดมิน] ล้างระบบ
            if (userMsg === 'ล้างระบบ') {
                if (!isAdmin) {
                    replyMsg = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
                } else {
                    usersWallets = {}; nextMemberId = 1; isRoundOpen = false; roundBets = {}; withdrawQueue = []; pendingResults = null;
                    replyMsg = "👑 [แอดมิน] ♻️ ล้างระบบสมาชิกเริ่มต้นใหม่เรียบร้อยแล้วครับ!";
                }
            }

            // ลงทะเบียนสมาชิกใหม่อัตโนมัติ
            else {
                if (!usersWallets[userId]) {
                    usersWallets[userId] = { 
                        memberNumber: nextMemberId,
                        memberTitle: `สมาชิกที่ ${nextMemberId}`,
                        name: "ผู้เล่นทั่วไป", 
                        balance: 0 
                    };
                    nextMemberId++;
                }
                
                const user = usersWallets[userId];
                const mentionText = `👤 ${user.memberTitle} `;
                const getQueueIndex = (uid) => withdrawQueue.findIndex(item => item.userId === uid) + 1;
                const hasPendingWithdraw = getQueueIndex(userId) > 0;

                // ==========================================
                // PART 1: ระบบเติมเงิน / ถอนเงิน
                // ==========================================
                if (originalMsg.startsWith('เติม')) {
                    if (!isAdmin) {
                        replyMsg = `${mentionText} ❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์เติมเงินครับ!`;
                    } else {
                        let targetUserId = null;
                        let amount = 0;
                        const moneyMatch = originalMsg.match(/\d+$/);
                        if (moneyMatch) amount = parseInt(moneyMatch[0]);

                        let cleanText = originalMsg.replace('เติม', '').trim();
                        if (moneyMatch) cleanText = cleanText.substring(0, cleanText.lastIndexOf(moneyMatch[0])).trim();
                        let searchKeyword = cleanText.replace('@', '').trim().toLowerCase().replace(/\s+/g, '');

                        if (event.message.mention && event.message.mention.mentions && event.message.mention.mentions.length > 0) {
                            targetUserId = event.message.mention.mentions[0].userId;
                            let parts = originalMsg.split(/\s+/);
                            let rawName = parts.find(p => p.includes('@'));
                            if (rawName && targetUserId) usersWallets[targetUserId].name = rawName.replace('@', '').trim();
                        } 
                        else if (searchKeyword) {
                            for (let uid in usersWallets) {
                                let u = usersWallets[uid];
                                if (u.memberTitle.toLowerCase().replace(/\s+/g, '') === searchKeyword || u.memberNumber.toString() === searchKeyword || u.name.toLowerCase().replace(/\s+/g, '').includes(searchKeyword)) {
                                    targetUserId = uid;
                                    break;
                                }
                            }
                        }

                        if (!targetUserId || isNaN(amount) || amount <= 0) {
                            replyMsg = `👑 [แอดมิน] ❌ เติมเงินไม่สำเร็จ\n📌 พิมพ์: **เติม [เลขสมาชิก] [เงิน]** (เช่น เติม 3 1000)`;
                        } else {
                            usersWallets[targetUserId].balance += amount;
                            let tUser = usersWallets[targetUserId];
                            let nameDisplay = tUser.name !== "ผู้เล่นทั่วไป" ? ` (@${tUser.name})` : "";
                            replyMsg = `👑 [แอดมิน] ✅ เติมเงินสำเร็จ! +${amount} บาท\n👤 ${tUser.memberTitle}${nameDisplay}\n💰 ยอดเงินคงเหลือปัจจุบัน: ${tUser.balance} บาท`;
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
                        }
                        let foundIndex = targetUserId ? withdrawQueue.findIndex(item => item.userId === targetUserId) : -1;
                        if (foundIndex === -1) {
                            replyMsg = `👑 [แอดมิน] ❌ ไม่พบรายการแจ้งถอนค้าง หรือลืมกดแท็กชื่อผู้เล่น`;
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
                    let nameDisplay = user.name !== "ผู้เล่นทั่วไป" ? `(@${user.name})` : "";
                    if (qPos > 0) {
                        replyMsg = `👤 ${user.memberTitle} ${nameDisplay}\n💰 ยอดเงินคงเหลือของคุณ: ${user.balance} บาท\n⚠️ (มีรายการแจ้งถอนค้างอยู่ ${withdrawQueue[qPos-1].amount} บาท ในคิวที่ ${qPos})`;
                    } else {
                        replyMsg = `👤 ${user.memberTitle} ${nameDisplay}\n💰 ยอดเงินคงเหลือของคุณ: ${user.balance} บาท`;
                    }
                }

                // ==========================================
                // PART 2: ระบบเปิดรอบ (O) / ปิดรอบ (X) -> สรุปสั้น
                // ==========================================
                else if (userMsg === 'o') {
                    if (!isAdmin) {
                        replyMsg = `${mentionText} ❌ คุณไม่ใช่แอดมิน ไม่สามารถเปิดรอบเดิมพันได้ครับ!`;
                    } else {
                        isRoundOpen = true; roundBets = {}; pendingResults = null;
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
                            // ✨ [อัปเดตตามสั่ง]: สรุปผลหลังปิดรอบสั้นๆ ว่าใครแทงรวมเท่าไหร่ ไม่บอกรายละเอียดขา
                            let summary = "🔴 [ระบบ] แอดมินปิดรับเดิมพันรอบนี้แล้ว!\n📋 [สรุปยอดเดิมพันรวม]:\n";
                            let hasData = false;
                            for (let uid in roundBets) {
                                let displayName = usersWallets[uid].name !== "ผู้เล่นทั่วไป" ? ` (@${usersWallets[uid].name})` : "";
                                summary += `▪️ ${usersWallets[uid].memberTitle}${displayName}: แทงรวม ${roundBets[uid].totalBet} บ.\n`;
                                hasData = true;
                            }
                            if (!hasData) summary += "❌ ไม่มีใครลงเดิมพันในรอบนี้\n";
                            replyMsg = summary + `\n⏳ รอแอดมินสรุปผลไพ่ โดยพิมพ์ 'ผล: [ไพ่ขา1],[ไพ่ขา2]...,[ไพ่เจ้ามือ]'`;
                        }
                    }
                }
                else if (userMsg === 'r') {
                    if (hasPendingWithdraw) {
                        replyMsg = `${mentionText} ❌ คุณมีรายการแจ้งถอนเงินตกค้างอยู่ ไม่สามารถทำรายการได้`;
                    } else if (!isRoundOpen) {
                        replyMsg = `${mentionText} ❌ ระบบปิดรอบไปแล้ว ไม่สามารถยกเลิกโพยได้ครับ`;
                    } else if (!roundBets[userId]) {
                        replyMsg = `${mentionText} ❌ คุณยังไม่มีโพยในรอบนี้ให้ยกเลิกครับ`;
                    } else {
                        const savedBet = roundBets[userId];
                        user.balance += savedBet.holding; delete roundBets[userId]; 
                        replyMsg = `${mentionText} 🔄 คืนโพยเรียบร้อยแล้วครับ!\n💰 ยอดเงินคงเหลือปัจจุบัน: ${user.balance} บาท`;
                    }
                }

                // ==========================================
                // PART 3: ระบบส่งโพยแทงของผู้เล่น
                // ==========================================
                else if (userMsg.startsWith('มข-') || userMsg.startsWith('มจ-') || userMsg.startsWith('จ') || (userMsg.includes('-') && !userMsg.startsWith('ผล:'))) {
                    if (hasPendingWithdraw) {
                        replyMsg = `${mentionText} ❌ **ไม่สามารถลงโพยได้!** มีรายการแจ้งถอนค้างอยู่`;
                    } 
                    else if (!isRoundOpen) {
                        replyMsg = `${mentionText} ❌ ยังไม่เปิดรอบ หรือระบบปิดรับเดิมพันไปแล้วครับ!`;
                    } 
                    else {
                        let betType = "", khas = [], betPerKha = 0, totalBet = 0, holding = 0;

                        if (userMsg.startsWith('มข-')) {
                            betPerKha = parseInt(userMsg.replace('มข-', ''));
                            if (!isNaN(betPerKha)) { betType = "มข"; khas = [1,2,3,4,5,6,7]; totalBet = betPerKha * 7; holding = totalBet * 2; }
                        }
                        else if (userMsg.startsWith('มจ-')) {
                            betPerKha = parseInt(userMsg.replace('มจ-', ''));
                            if (!isNaN(betPerKha)) { betType = "มจ"; khas = [1,2,3,4,5,6,7]; totalBet = betPerKha * 7; holding = totalBet * 2; }
                        }
                        else if (userMsg.startsWith('จ')) {
                            const parts = userMsg.substring(1).split('-');
                            if (parts.length === 2) {
                                khas = parts[0].split('').map(Number); betPerKha = parseInt(parts[1]);
                                betType = "จ"; totalBet = betPerKha * khas.length; holding = totalBet * 2;
                            }
                        }
                        else if (userMsg.includes('-')) {
                            const parts = userMsg.split('-');
                            if (parts.length === 2 && !isNaN(parts[0])) {
                                khas = parts[0].split('').map(Number); betPerKha = parseInt(parts[1]);
                                betType = "เดี่ยว"; totalBet = betPerKha * khas.length; holding = totalBet * 2;
                            }
                        }

                        if (holding > 0) {
                            if (roundBets[userId]) user.balance += roundBets[userId].holding;
                            if (user.balance < holding) {
                                replyMsg = `${mentionText} ❌ แทงไม่ได้ครับ! ยอดเงินคงเหลือไม่พอค่าค้ำประกัน (${holding} บ.)`;
                                if (roundBets[userId]) user.balance -= roundBets[userId].holding; 
                            } else {
                                user.balance -= holding; 
                                roundBets[userId] = { type: betType, khas: khas, betPerKha: betPerKha, totalBet: totalBet, holding: holding };
                                replyMsg = `${mentionText} 🎯 [จดโพยสำเร็จ] แทงรวม: ${totalBet} บ. (หักค้ำ ${holding} บ.)`;
                            }
                        }
                    }
                }

                // ==========================================
                // PART 4: ระบบรับผลรอบแรก (จับแต้ม/โชว์สถานะขา) -> ยังไม่ตัดยอดเงิน
                // ==========================================
                else if (originalMsg.startsWith('ผล:') || originalMsg.startsWith('ผล ')) {
                    if (!isAdmin) {
                        replyMsg = `${mentionText} ❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ส่งผลครับ!`;
                    } else {
                        const resultStr = originalMsg.replace(/^ผล:\s*|^ผล\s+/i, '');
                        const results = resultStr.split(','); 
                        
                        if (results.length >= 2) {
                            let dealerRaw = results[results.length - 1];
                            let dealerResult = parseCard(dealerRaw);
                            
                            // ✨ เก็บผลไพ่ดิบลงตัวแปรชั่วคราวเพื่อรอยืนยัน
                            pendingResults = { dealerResult, results };

                            let previewText = `🃏 [ตรวจสอบผลไพ่ประจำรอบ]\n👑 เจ้ามือ: ${dealerResult.score} แต้ม (${dealerResult.deng} เด้ง)\n------------------------\n`;
                            
                            // ลูปโชว์สถานะแต้มและผลลัพธ์ของแต่ละขา (1-7) เทียบกับเจ้ามือให้แอดมินตรวจ
                            for (let i = 1; i <= results.length - 1; i++) {
                                let pRaw = results[i - 1];
                                let playerResult = parseCard(pRaw);
                                let status = "";

                                if (playerResult.score > dealerResult.score) {
                                    status = `✅ ชนะเจ้า (ได้ ${playerResult.deng} เด้ง)`;
                                } else if (playerResult.score < dealerResult.score) {
                                    status = `❌ แพ้เจ้า (เจ้ากิน ${dealerResult.deng} เด้ง)`;
                                } else {
                                    // ✨ [แก้ไขกติกา]: แต้มเท่ากัน = เสมอกัน 100% ไม่มีได้เสียเด้ง
                                    status = `🤝 เสมอเจ้า (แต้มเท่าเจ๊า)`;
                                }
                                previewText += `🔹 ขา ${i} [${playerResult.score} แต้ม]: ${status}\n`;
                            }

                            replyMsg = previewText + `\n📢 แอดมินกรุณาตรวจสอบผลไพ่ด้านบน:\n👍 หากถูกต้องพิมพ์: **OK**\n👎 หากต้องการส่งใหม่พิมพ์: **NO**`;
                        }
                    }
                }

                // ==========================================
                // PART 5: ระบบตอบรับแอดมิน (OK = คิดเงินสรุปสั้น / NO = ยกเลิก)
                // ==========================================
                else if (userMsg === 'ok') {
                    if (!isAdmin) {
                        replyMsg = `${mentionText} ❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์กดคอนเฟิร์มผลครับ!`;
                    } else if (!pendingResults) {
                        replyMsg = `👑 [แอดมิน] ⚠️ ไม่มีผลไพ่ค้างคาในระบบให้คอนเฟิร์มครับ`;
                    } else {
                        let { dealerResult, results } = pendingResults;
                        let summaryText = `📊 [สรุปผลคิดเงินป๊อกเด้ง - จบรอบ]\n👑 เจ้ามือได้: ${dealerResult.score} แต้ม (${dealerResult.deng} เด้ง)\n------------------------\n`;
                        
                        // คำนวณเงินจริงของสมาชิกแต่ละคน
                        for (let uid in roundBets) {
                            let savedBet = roundBets[uid];
                            let pUser = usersWallets[uid];
                            let userTotalReturn = 0; // เงินค้ำ+กำไร ที่จะคืนเข้ากระเป๋า
                            let totalWinLoss = 0;   // ยอด สุทธิสุทธิที่ + หรือ - ในรอบนี้

                            savedBet.khas.forEach(khaNum => {
                                let pRaw = results[khaNum - 1];
                                let playerResult = parseCard(pRaw);
                                let bet = savedBet.betPerKha;
                                let isDealerSide = (savedBet.type === 'มจ' || savedBet.type === 'จ');

                                let singleHolding = bet * 2; 
                                let winLoss = 0;

                                // แต้มผู้เล่นชนะ
                                if (playerResult.score > dealerResult.score) {
                                    let winAmount = bet * playerResult.deng;
                                    winLoss = isDealerSide ? (-winAmount) : winAmount;
                                    userTotalReturn += isDealerSide ? 0 : (singleHolding + winAmount);
                                } 
                                // แต้มเจ้ามือชนะ
                                else if (playerResult.score < dealerResult.score) {
                                    let loseAmount = bet * dealerResult.deng;
                                    if (isDealerSide) {
                                        let profit = loseAmount * 0.9; // หักน้ำ 10%
                                        winLoss = profit;
                                        userTotalReturn += (singleHolding + profit);
                                    } else {
                                        winLoss = -loseAmount;
                                        userTotalReturn += (singleHolding - loseAmount);
                                    }
                                } 
                                // ✨ [แก้ไขกติกา]: แต้มเท่ากันคือเสมอ 100% ไม่มีได้เสียเด้ง คืนยอดค้ำประกันเต็มจำนวน
                                else {
                                    winLoss = 0; 
                                    userTotalReturn += singleHolding; 
                                }

                                totalWinLoss += winLoss;
                            });

                            // อัปเดตเงินในกระเป๋าผู้เล่น
                            pUser.balance += userTotalReturn;
                            
                            // จัดรูปแบบข้อความแสดงผลแพ้ชนะสุทธิ
                            let winLossSign = totalWinLoss > 0 ? `+${totalWinLoss}` : (totalWinLoss === 0 ? `เสมอ (0)` : `${totalWinLoss}`);
                            let displayName = pUser.name !== "ผู้เล่นทั่วไป" ? ` (@${pUser.name})` : "";
                            
                            // ✨ [อัปเดตตามสั่ง]: แสดงสั้นๆ แค่ว่าสมาชิกไหน ได้หรือเสียเท่าไหร่ ไม่บอกประวัติขาแยก
                            summaryText += `👤 ${pUser.memberTitle}${displayName}: **${winLossSign} บาท**\n`;
                        }

                        replyMsg = summaryText + `\n✨ เคลียร์ยอดระบบเรียบร้อย พิมพ์ O เพื่อเริ่มรอบใหม่ครับ`;
                        roundBets = {}; 
                        pendingResults = null; // เคลียร์ผลพัก
                    }
                }
                else if (userMsg === 'no') {
                    if (!isAdmin) {
                        replyMsg = `${mentionText} ❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ`;
                    } else if (!pendingResults) {
                        replyMsg = `👑 [แอดมิน] ⚠️ ไม่มีผลไพ่ค้างในระบบให้ยกเลิกครับ`;
                    } else {
                        pendingResults = null; // ล้างผลพักทิ้ง
                        replyMsg = `👑 [แอดมิน] 🛑 ยกเลิกผลไพ่เรียบร้อยแล้วครับ แอดมินสามารถส่งผลไพ่ใหม่คีย์เวิร์ดเดิมได้ทันทีเลยครับ`;
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
