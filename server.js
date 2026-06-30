const express = require('express');
const app = express();
app.use(express.json());

// ฐานข้อมูลจำลอง (จำในแรม)
let usersWallets = {}; // { userId: { name: "ชื่อ", balance: 0 } }
let isRoundOpen = false;
let roundBets = {}; 
let withdrawQueue = []; 

// ⚠️ อย่าลืมใส่ LINE USER ID ของคุณ (แอดมิน) ตรงนี้ เพื่อให้ได้รับสิทธิ์คุมวง
const ADMIN_USER_ID = "ใส่_LINE_USER_ID_ของแอดมินตรงนี้"; 

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

            const isAdmin = (userId === ADMIN_USER_ID);

            // ระบบจำและแท็กชื่อสมาชิกใหม่อัตโนมัติ
            if (!usersWallets[userId]) {
                try {
                    const profileRes = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
                        headers: { 'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` }
                    });
                    const profile = await profileRes.json();
                    usersWallets[userId] = { name: profile.displayName || "สมาชิกใหม่", balance: 0 };
                } catch (e) {
                    usersWallets[userId] = { name: "สมาชิกใหม่", balance: 0 };
                }
            }
            
            const user = usersWallets[userId];
            const mentionText = `👤 @${user.name} `;
            const getQueueIndex = (uid) => withdrawQueue.findIndex(item => item.userId === uid) + 1;
            const hasPendingWithdraw = getQueueIndex(userId) > 0;

            // ==========================================
            // SYSTEM COMMAND: คู่มือคำสั่ง
            // ==========================================
            if (userMsg === 'คำสั่ง' || userMsg === 'help') {
                replyMsg = `📖 [คู่มือคีย์ลัดระบบป๊อกเด้ง]\n` +
                           `------------------------\n` +
                           `📌 **สำหรับผู้เล่นทั่วไป:**\n` +
                           `• พิมพ์ [C] : เช็คยอดเงินคงเหลือในกระเป๋า\n` +
                           `• พิมพ์ [ถอน จำนวนเงิน] : แจ้งถอนเงิน (เข้าคิวรอแอดมินอนุมัติ)\n` +
                           `• พิมพ์ [R] : ยกเลิกโพยล่าสุดประจำรอบ\n` +
                           `• ส่งโพยแทง : [ขา]-[ราคา] (เช่น 123-50)\n\n` +
                           `👑 **สำหรับแอดมินเท่านั้น:**\n` +
                           `• พิมพ์ [เติม ชื่อ/แท็ก จำนวนเงิน] : เติมเงินให้ผู้เล่นรายคน\n` +
                           `• หรือกด Reply ข้อความลูกค้า แล้วพิมพ์ [เติม จำนวนเงิน]\n` +
                           `• พิมพ์ [Y ชื่อผู้เล่น] : อนุมัติถอนเงินตามชื่อคิว\n` +
                           `• พิมพ์ [O] : เปิดรอบ / [X] : ปิดรอบสรุปโพย\n` +
                           `• พิมพ์ [ผล: ไพ่ขา1...,ไพ่เจ้ามือ] : คิดเงินประจำรอบ`;
            }

            // ==========================================
            // PART 1: ระบบเติมเงิน (เวอร์ชันใหม่) / ถอนเงิน / คอนเฟิร์ม Y
            // ==========================================
            else if (originalMsg.startsWith('เติม')) {
                if (!isAdmin) {
                    replyMsg = `${mentionText} ❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งเติมเงินครับ!`;
                } else {
                    let targetUserId = null;
                    let amount = 0;

                    // วิธีที่ 1: แอดมินกด Reply (ตอบกลับ) ข้อความของคนที่จะเติมเงิน แล้วพิมพ์ "เติม 1000"
                    if (event.message.quotedMessageId) {
                        const cleanMsg = originalMsg.replace('เติม', '').trim();
                        amount = parseInt(cleanMsg);
                        
                        // ค้นหาข้อความที่ถูก Reply เพื่อหา userId ต้นทาง (ใช้ webhook context ดักจับ)
                        // เพื่อความแม่นยำสูงสุดในกลุ่มไลน์ แนะนำให้ใช้พิมพ์ชื่อแนบไปด้วยตามวิธีที่ 2 ด้านล่าง หรือถ้าบอทจำ user ล่าสุดไว้ได้
                        targetUserId = event.message.quotedMessageId ? "reply_mode" : null;
                    }

                    // วิธีที่ 2: แอดมินพิมพ์ "เติม @ชื่อผู้เล่น 1000" หรือ "เติม ชื่อผู้เล่น 1000"
                    if (targetUserId !== "reply_mode") {
                        const tokens = originalMsg.split(/\s+/); // แยกด้วยช่องว่าง
                        if (tokens.length >= 3) {
                            const targetName = tokens[1].replace('@', '').trim();
                            amount = parseInt(tokens[2]);

                            // วนลูปหาคนที่มีชื่อตรงกันในฐานข้อมูลบอท
                            for (let uid in usersWallets) {
                                if (usersWallets[uid].name.toLowerCase().includes(targetName.toLowerCase())) {
                                    targetUserId = uid;
                                    break;
                                }
                            }
                        }
                    }

                    // จัดการเครดิตเงิน
                    if (!targetUserId || isNaN(amount) || amount <= 0) {
                        replyMsg = `👑 [แอดมิน] ❌ รูปแบบคำสั่งเติมเงินไม่ถูกต้อง\n📌 กรุณาพิมพ์: **เติม [ชื่อหรือแท็กคนเล่น] [จำนวนเงิน]** (เช่น เติม สมาชิกที่1 1000)`;
                    } else {
                        // หากเป็นการ Reply ข้อความ (ดักจับหาเป้าหมายจากคิวหรือประวัติผู้เล่น)
                        if (targetUserId === "reply_mode") {
                             replyMsg = `👑 [แอดมิน] ❌ ระบบตรวจไม่พบ ID จากการ Reply กรุณาใช้การพิมพ์ชื่อระบุตัวตน เช่น **เติม ชื่อลูกค้า ${amount}** เพื่อความแม่นยำครับ`;
                        } else {
                            usersWallets[targetUserId].balance += amount;
                            replyMsg = `👑 [แอดมิน] ✅ เติมเงินสำเร็จ! +${amount} บาท\n👤 @${usersWallets[targetUserId].name}\n💰 ยอดเงินคงเหลือปัจจุบัน: ${usersWallets[targetUserId].balance} บาท`;
                        }
                    }
                }
            }
            else if (userMsg.startsWith('ถอน')) {
                const qPos = getQueueIndex(userId);
                if (qPos > 0) {
                    replyMsg = `${mentionText} ⚠️ รายการถอนเงินจำนวน ${withdrawQueue[qPos-1].amount} บาทของคุณ "อยู่ระหว่างดำเนินการ" (คุณอยู่ในคิวที่ ${qPos} ของระบบครับ)`;
                } else {
                    const amount = parseInt(userMsg.replace('ถอน', ''));
                    if (!isNaN(amount) && amount > 0) {
                        if (user.balance < amount) {
                            replyMsg = `${mentionText} ❌ ไม่สามารถแจ้งถอนได้ ยอดเงินในกระเป๋าไม่พอ (มีอยู่ ${user.balance} บ.)`;
                        } else {
                            withdrawQueue.push({ userId: userId, amount: amount });
                            const currentQ = withdrawQueue.length;
                            replyMsg = `${mentionText} 🔔 แจ้งถอนเงินจำนวน ${amount} บาท สำเร็จ!\n⏳ [สถานะ]: อยู่ระหว่างดำเนินการ... คุณจัดอยู่ใน **คิวที่ ${currentQ}** ของระบบ\n🔒 *(ระบบล็อกชั่วคราว: คุณจะไม่สามารถลงเดิมพันได้จนกว่าแอดมินจะอนุมัติคิวนี้)*`;
                        }
                    }
                }
            }
            else if (originalMsg.startsWith('Y ') || originalMsg.startsWith('y ')) {
                if (!isAdmin) {
                    replyMsg = `${mentionText} ❌ คุณไม่ใช่แอดมิน ไม่สามารถอนุมัติรายการถอนเงินได้ครับ`;
                } else {
                    const targetName = originalMsg.substring(2).trim().replace('@', '');
                    let foundIndex = -1;
                    
                    for (let i = 0; i < withdrawQueue.length; i++) {
                        let uid = withdrawQueue[i].userId;
                        if (usersWallets[uid].name.toLowerCase().includes(targetName.toLowerCase())) {
                            foundIndex = i;
                            break;
                        }
                    }

                    if (foundIndex === -1) {
                        replyMsg = `👑 [แอดมิน] ❌ ไม่พบชื่อผู้แจ้งถอนเงินที่ตรงกับ "${targetName}" ในระบบคิวปัจจุบัน`;
                    } else {
                        const targetItem = withdrawQueue[foundIndex];
                        const targetUser = usersWallets[targetItem.userId];
                        
                        targetUser.balance -= targetItem.amount;
                        withdrawQueue.splice(foundIndex, 1);
                        
                        replyMsg = `👑 [แอดมิน] ✅ อนุมัติการถอนเงินเรียบร้อย!\n👤 @${targetUser.name} ถอนเงินสำเร็จ -${targetItem.amount} บาท\n💰 ยอดเงินคงเหลือปัจจุบัน: ${targetUser.balance} บาท\n🔓 ปลดล็อกระบบกลับเข้าสู่วงเล่นได้ตามปกติครับ`;
                    }
                }
            }
            else if (userMsg === 'c') {
                const qPos = getQueueIndex(userId);
                if (qPos > 0) {
                    replyMsg = `${mentionText}\n💰 ยอดเงินคงเหลือของคุณ: ${user.balance} บาท\n⚠️ (คุณมีรายการแจ้งถอนค้างอยู่ ${withdrawQueue[qPos-1].amount} บาท อยู่ในคิวที่ ${qPos})`;
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
                            summary += `▪️ @${usersWallets[uid].name}: แทงรวม ${roundBets[uid].totalBet} บ. (ค้ำ ${roundBets[uid].holding} บ.)\n`;
                            hasData = true;
                        }
                        if (!hasData) summary += "❌ ไม่มีใครลงเดิมพันในรอบนี้\n";
                        replyMsg = summary + `\n⏳ รอแอดมินสรุปผลไพ่ โดยพิมพ์ 'ผล: [ไพ่ขา1],[ไพ่ขา2]...,[ไพ่เจ้ามือ]'`;
                    }
                }
            }
            else if (userMsg === 'r') {
                if (hasPendingWithdraw) {
                    replyMsg = `${mentionText} ❌ คุณมีรายการแจ้งถอนเงินตกค้างอยู่ ไม่สามารถร่วมทำรายการใดๆ ในวงได้ครับ`;
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
                    replyMsg = `${mentionText} ❌ **ไม่สามารถลงโพยได้!** เนื่องจากคุณมีรายการแจ้งถอนเงินค้างอยู่ในระบบ (คิวที่ ${qPos}) กรุณารอแอดมินอนุมัติเงินถอนให้เสร็จสิ้นก่อนครับ`;
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
                            replyMsg = `${mentionText} 🎯 [จดโพยสำเร็จ]\n📝 โพย: ${originalMsg}\n🔒 หักเงินค้ำประกัน: ${holding} บาท\n💰 ยอดเงินคงเหลือหลังหักค้ำ: ${user.balance} บาท\n*(หากต้องการยกเลิกโพยนี้ ให้พิมพ์ R)*`;
                        }
                    }
                }
            }

            // ==========================================
            // PART 4: ระบบคิดเงิน (เฉพาะแอดมินส่งผล)
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

                            summaryText += `👤 @${pUser.name}:\n`;

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
