const express = require('express');
const app = express();
app.use(express.json());

// ระบบฐานข้อมูลจำลอง (จำในแรม)
let usersWallets = {}; // { userId: { name: "ชื่อ", balance: 0 } }
let isRoundOpen = false;

// โครงสร้างเก็บโพยรายรอบ ผูกกับ userId คนแทง
let roundBets = {}; 

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

            // ระบบดึงชื่อโปรไฟล์ไลน์มาจำในฐานข้อมูลสมาชิกอัตโนมัติ
            if (!usersWallets[userId]) {
                try {
                    const profileRes = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
                        headers: { 'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` }
                    });
                    const profile = await profileRes.json();
                    usersWallets[userId] = { name: profile.displayName || "สมาชิกใหม่", balance: 0 };
                } catch (e) {
                    usersWallets[userId] = { name: "สมาชิก", balance: 0 };
                }
            }
            
            const user = usersWallets[userId];
            const mentionText = `👤 @${user.name} `;

            // ==========================================
            // PART 1: ระบบเติมเงิน / ถอนเงิน / เช็คกระเป๋า (คำสั่ง C)
            // ==========================================
            if (userMsg.startsWith('เติม')) {
                const amount = parseInt(userMsg.replace('เติม', ''));
                if (!isNaN(amount) && amount > 0) {
                    user.balance += amount;
                    replyMsg = `${mentionText} เติมเงินสำเร็จ +${amount} บาท\n💰 ยอดเงินคงเหลือปัจจุบัน: ${user.balance} บาท`;
                }
            }
            else if (userMsg.startsWith('ถอน')) {
                const amount = parseInt(userMsg.replace('ถอน', ''));
                if (!isNaN(amount) && amount > 0) {
                    if (user.balance < amount) {
                        replyMsg = `${mentionText} ❌ ไม่สามารถถอนได้ ยอดเงินในกระเป๋าไม่พอ (มีอยู่ ${user.balance} บ.)`;
                    } else {
                        user.balance -= amount;
                        replyMsg = `${mentionText} ถอนเงินสำเร็จ -${amount} บาท\n💰 ยอดเงินคงเหลือปัจจุบัน: ${user.balance} บาท`;
                    }
                }
            }
            else if (userMsg === 'c') { // เปลี่ยนเป็นคำสั่ง C ตามคำขอ
                replyMsg = `${mentionText}\n💰 ยอดเงินคงเหลือของคุณ: ${user.balance} บาท`;
            }

            // ==========================================
            // PART 2: ระบบเปิดรอบ (O) / ปิดรอบ (X) / ยกเลิกโพย (R)
            // ==========================================
            else if (userMsg === 'o') {
                isRoundOpen = true;
                roundBets = {}; 
                replyMsg = "🟢 [ระบบ] เปิดรับเดิมพันรอบใหม่แล้ว! ส่งโพยมาได้เลยครับ";
            }
            else if (userMsg === 'x') {
                if (!isRoundOpen) {
                    replyMsg = "⚠️ รอบเดิมพันปิดอยู่แล้วครับ พิมพ์ O เพื่อเปิดรอบ";
                } else {
                    isRoundOpen = false;
                    let summary = "🔴 [ระบบ] ปิดรับเดิมพันแล้ว!\n📋 [สรุปโพยประจำรอบนี้]:\n";
                    let hasData = false;
                    for (let uid in roundBets) {
                        summary += `▪️ @${usersWallets[uid].name}: แทงรวม ${roundBets[uid].totalBet} บ. (ค้ำ ${roundBets[uid].holding} บ.)\n`;
                        hasData = true;
                    }
                    if (!hasData) summary += "❌ ไม่มีใครลงเดิมพันในรอบนี้\n";
                    replyMsg = summary + `\n⏳ รอสรุปผลไพ่ โดยพิมพ์ 'ผล: [ไพ่ขา1],[ไพ่ขา2]...,[ไพ่เจ้ามือ]'`;
                }
            }
            else if (userMsg === 'r') { // ระบบยกเลิกโพยและแท็กชื่อแจ้งเตือน
                if (!isRoundOpen) {
                    replyMsg = `${mentionText} ❌ ระบบปิดรอบไปแล้ว ไม่สามารถยกเลิกโพยได้ครับ`;
                } else if (!roundBets[userId]) {
                    replyMsg = `${mentionText} ❌ คุณยังไม่มีโพยในรอบนี้ให้ยกเลิกครับ`;
                } else {
                    const savedBet = roundBets[userId];
                    user.balance += savedBet.holding; // คืนเงินค้ำประกันเข้ากระเป๋า
                    delete roundBets[userId]; // ลบโพย
                    replyMsg = `${mentionText} 🔄 คืนโพยเรียบร้อยแล้วครับ! วงเงินค้ำประกัน ${savedBet.holding} บาท ถูกโอนกลับเข้ากระเป๋าคุณแล้ว\n💰 ยอดเงินคงเหลือปัจจุบัน: ${user.balance} บาท`;
                }
            }

            // ==========================================
            // PART 3: ระบบส่งโพยแทง
            // ==========================================
            else if (userMsg.startsWith('มข-') || userMsg.startsWith('มจ-') || userMsg.startsWith('จ') || (userMsg.includes('-') && !userMsg.startsWith('ผล:'))) {
                if (!isRoundOpen) {
                    replyMsg = `${mentionText} ❌ ยังไม่เปิดรอบ หรือระบบปิดรับเดิมพันไปแล้วครับ!`;
                } else {
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
            // PART 4: ระบบคิดเงิน (เรียงตามคำขอใหม่: ขา 1-7 จบด้วย เจ้ามือ)
            // ==========================================
            else if (originalMsg.startsWith('ผล:') || originalMsg.startsWith('ผล ')) {
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
