const express = require('express');
const app = express();
app.use(express.json());

// ฐานข้อมูลจำลอง (จำในแรม)
let usersWallets = {}; 
let nextMemberId = 1;  
let isRoundOpen = false;
let roundBets = {}; 
let withdrawQueue = []; 

// ตัวแปรระบบสำหรับพักข้อมูลผลไพ่เพื่อรอแอดมินคอนเฟิร์ม
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
                // PART 1: ระบบเติมเงิน / ถอนเงิน / เช็กยอดกระเป๋า
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
                // PART 2: ระบบเปิดรอบ (O) / ปิดรอบ (X) / คืนโพย (R)
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
                        user.balance += savedBet.holding; 
                        delete roundBets[userId]; 
                        replyMsg = `${mentionText} 🔄 คืนโพยทั้งหมดในรอบนี้เรียบร้อยแล้วครับ!\n💰 ยอดเงินคงเหลือปัจจุบัน: ${user.balance} บาท`;
                    }
                }

                // ==========================================
                // PART 3: ระบบรับโพยสะสมยอด (คลุมขาผู้เล่น 1 ถึง 6 เท่านั้น)
                // ==========================================
                else {
                    const lines = originalMsg.split('\n');
                    let isBetMessage = false;
                    
                    for (let line of lines) {
                        let cleanLine = line.toLowerCase().replace(/\s+/g, '');
                        if (cleanLine.startsWith('มข-') || cleanLine.startsWith('มจ-') || cleanLine.startsWith('จ') || (cleanLine.includes('-') && !cleanLine.startsWith('ผล:'))) {
                            isBetMessage = true;
                            break;
                        }
                    }

                    if (isBetMessage) {
                        if (hasPendingWithdraw) {
                            replyMsg = `${mentionText} ❌ **ไม่สามารถลงโพยได้!** มีรายการแจ้งถอนค้างอยู่`;
                        } else if (!isRoundOpen) {
                            replyMsg = `${mentionText} ❌ ยังไม่เปิดรอบ หรือระบบปิดรับเดิมพันไปแล้วครับ!`;
                        } else {
                            let totalNewHolding = 0;
                            let newKhasList = []; 
                            let hasErrorLeg = false; 

                            if (!roundBets[userId]) {
                                roundBets[userId] = { 
                                    totalBet: 0, 
                                    holding: 0, 
                                    khasDetails: {} 
                                };
                            }

                            let currentBetData = roundBets[userId];
                            let backupKhasDetails = JSON.parse(JSON.stringify(currentBetData.khasDetails)); 

                            for (let line of lines) {
                                let cleanLine = line.toLowerCase().replace(/\s+/g, '');
                                if (!cleanLine) continue;

                                let betType = "", khas = [], betPerKha = 0, lineTotalBet = 0, lineHolding = 0;
                                let formatText = ""; 

                                if (cleanLine.startsWith('มข-')) {
                                    betPerKha = parseInt(cleanLine.replace('มข-', ''));
                                    if (!isNaN(betPerKha) && betPerKha > 0) { 
                                        betType = "มข"; khas = [1,2,3,4,5,6]; 
                                        formatText = `มข (เหมาผู้เล่นสู้เจ้า) ขาละ ${betPerKha}`;
                                    }
                                }
                                else if (cleanLine.startsWith('มจ-')) {
                                    betPerKha = parseInt(cleanLine.replace('มจ-', ''));
                                    if (!isNaN(betPerKha) && betPerKha > 0) { 
                                        betType = "มจ"; khas = [1,2,3,4,5,6]; 
                                        formatText = `มจ (เหมาเจ้ามือสู้ทุกขา) ขาละ ${betPerKha}`;
                                    }
                                }
                                else if (cleanLine.startsWith('จ')) {
                                    const parts = cleanLine.substring(1).split('-');
                                    if (parts.length === 2) {
                                        let rawKhas = parts[0].split('').map(Number);
                                        let invalidCheck = rawKhas.some(k => k < 1 || k > 6 || isNaN(k));
                                        if (!invalidCheck) {
                                            khas = rawKhas;
                                            betPerKha = parseInt(parts[1]);
                                            betType = "จ";
                                            formatText = `จ${parts[0]} (เจ้ามือสู้ขา ${parts[0].split('').join(',')}) - ${betPerKha}`;
                                        } else {
                                            hasErrorLeg = true;
                                        }
                                    }
                                }
                                else if (cleanLine.includes('-')) {
                                    const parts = cleanLine.split('-');
                                    if (parts.length === 2 && !isNaN(parts[0])) {
                                        let rawKhas = parts[0].split('').map(Number);
                                        let invalidCheck = rawKhas.some(k => k < 1 || k > 6 || isNaN(k));
                                        if (!invalidCheck) {
                                            khas = rawKhas;
                                            betPerKha = parseInt(parts[1]);
                                            betType = "เดี่ยว";
                                            formatText = `${parts[0]}-${betPerKha}`;
                                        } else {
                                            hasErrorLeg = true;
                                        }
                                    }
                                }

                                if (khas.length > 0 && !isNaN(betPerKha) && betPerKha > 0) {
                                    khas.forEach(k => {
                                        if (!currentBetData.khasDetails[k]) {
                                            currentBetData.khasDetails[k] = { type: betType, bet: 0 };
                                        }
                                        currentBetData.khasDetails[k].bet += betPerKha;
                                        currentBetData.khasDetails[k].type = betType; 
                                        
                                        lineTotalBet += betPerKha;
                                        lineHolding += (betPerKha * 2);
                                    });

                                    totalNewHolding += lineHolding;
                                    currentBetData.totalBet += lineTotalBet;
                                    currentBetData.holding += lineHolding;
                                    
                                    newKhasList.push(formatText);
                                }
                            }

                            if (totalNewHolding > 0 && !hasErrorLeg) {
                                if (user.balance < totalNewHolding) {
                                    replyMsg = `${mentionText} ❌ ไม่สามารถเพิ่มโพยได้! ยอดเงินคงเหลือไม่พอค่าค้ำประกันเพิ่ม (ต้องการค้ำเพิ่มอีก ${totalNewHolding} บ.)`;
                                    currentBetData.khasDetails = backupKhasDetails; 
                                } else {
                                    user.balance -= totalNewHolding;
                                    replyMsg = `${mentionText} 🎯 [จดโพยชุดสำเร็จ]\n📥 โพยที่รับเพิ่มรอบนี้:\n  • ${newKhasList.join('\n  • ')}\n💰 ยอดเดิมพันรวมสะสมปัจจุบัน: ${currentBetData.totalBet} บ. (หักค้ำรวม: ${currentBetData.holding} บ.)\n💳 **ยอดเงินคงเหลือในกระเป๋าคุณ: ${user.balance} บาท**`;
                                }
                            } else {
                                currentBetData.khasDetails = backupKhasDetails;
                                replyMsg = `${mentionText} ❌ โพยไม่สำเร็จ! ตรวจพบรูปแบบผิดพลาด หรือระบุเลขขาเกินขอบเขต (ระบบรับเฉพาะเลขขาผู้เล่น 1 ถึง 6 เท่านั้นครับ)`;
                                if (currentBetData.totalBet === 0) delete roundBets[userId];
                            }
                        }
                    }
                }

                // ==========================================
                // PART 4: ระบบรับผลรอบแรก (ตรวจสถานะแต้มไพ่)
                // ==========================================
                if (originalMsg.startsWith('ผล:') || originalMsg.startsWith('ผล ')) {
                    if (!isAdmin) {
                        replyMsg = `${mentionText} ❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ส่งผลครับ!`;
                    } else {
                        const resultStr = originalMsg.replace(/^ผล:\s*|^ผล\s+/i, '');
                        const results = resultStr.split(','); 
                        
                        if (results.length >= 2) {
                            let dealerRaw = results[results.length - 1]; 
                            let dealerResult = parseCard(dealerRaw);
                            pendingResults = { dealerResult, results };

                            let previewText = `🃏 [ตรวจสอบผลไพ่ประจำรอบ]\n👑 เจ้ามือ (ขา 7): ${dealerResult.score} แต้ม (${dealerResult.deng} เด้ง)\n------------------------\n`;
                            
                            for (let i = 1; i <= results.length - 1; i++) {
                                if (i > 6) break;
                                let pRaw = results[i - 1];
                                let playerResult = parseCard(pRaw);
                                let status = "";

                                if (playerResult.score > dealerResult.score) {
                                    status = `✅ ชนะเจ้า (ได้ ${playerResult.deng} เด้ง)`;
                                } else if (playerResult.score < dealerResult.score) {
                                    status = `❌ แพ้เจ้า (เจ้ากิน ${dealerResult.deng} เด้ง)`;
                                } else {
                                    status = `🤝 เสมอเจ้า (แต้มเท่าเจ๊า)`;
                                }
                                previewText += `🔹 ขา ${i} [${playerResult.score} แต้ม]: ${status}\n`;
                            }

                            replyMsg = previewText + `\n📢 แอดมินกรุณาตรวจสอบผลไพ่ด้านบน:\n👍 หากถูกต้องพิมพ์: **OK**\n👎 หากต้องการส่งใหม่พิมพ์: **NO**`;
                        }
                    }
                }

                // ==========================================
                // PART 5: ระบบคำนวณเงินสิ้นสุดรอบ + กางรายละเอียดรายขาถูกต้อง 100%
                // ==========================================
                else if (userMsg === 'ok') {
                    if (!isAdmin) {
                        replyMsg = `${mentionText} ❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์กดคอนเฟิร์มผลครับ!`;
                    } else if (!pendingResults) {
                        replyMsg = `👑 [แอดมิน] ⚠️ ไม่มีผลไพ่ค้างคาในระบบให้คอนเฟิร์มครับ`;
                    } else {
                        let { dealerResult, results } = pendingResults;
                        let summaryText = `📊 [สรุปผลคิดเงินป๊อกเด้ง - จบรอบ]\n👑 เจ้ามือได้: ${dealerResult.score} แต้ม (${dealerResult.deng} เด้ง)\n------------------------\n`;
                        
                        for (let uid in roundBets) {
                            let savedBet = roundBets[uid];
                            let pUser = usersWallets[uid];
                            let userTotalReturn = 0; 
                            let totalWinLoss = 0;   
                            let legDetailsText = ""; 

                            for (let khaNum in savedBet.khasDetails) {
                                let khaData = savedBet.khasDetails[khaNum];
                                let pRaw = results[parseInt(khaNum) - 1];
                                if (!pRaw) continue; 
                                
                                let playerResult = parseCard(pRaw);
                                let bet = khaData.bet;
                                let isDealerSide = (khaData.type === 'มจ' || khaData.type === 'จ');
                                let singleHolding = bet * 2; 
                                let winLoss = 0;
                                let legLabel = ""; 

                                if (!isDealerSide) {
                                    // 🔹 ฝั่งผู้เล่นทั่วไป (เดี่ยว / มข)
                                    legLabel = khaData.type === 'มข' ? `มข ขา ${khaNum}` : `ขา ${khaNum}`;
                                    if (playerResult.score > dealerResult.score) {
                                        let winAmount = bet * playerResult.deng;
                                        winLoss = winAmount;
                                        userTotalReturn += (singleHolding + winAmount); 
                                    } else if (playerResult.score < dealerResult.score) {
                                        let loseAmount = bet * dealerResult.deng;
                                        winLoss = -loseAmount;
                                        userTotalReturn += (singleHolding - loseAmount); 
                                    } else {
                                        winLoss = 0;
                                        userTotalReturn += singleHolding;
                                    }
                                } else {
                                    // 🔸 ฝั่งเจ้ามือ (จ / มจ) - แก้ไขการคืนเงินค้ำและหักค่าน้ำถูกต้อง
                                    legLabel = khaData.type === 'มจ' ? `มจ (เจ้าสู้ขา ${khaNum})` : `จ${khaNum} (เจ้าสู้ขา ${khaNum})`;
                                    if (dealerResult.score > playerResult.score) {
                                        let grossProfit = bet * dealerResult.deng;
                                        let netProfit = grossProfit * 0.90; 
                                        winLoss = netProfit;
                                        userTotalReturn += (singleHolding + netProfit); 
                                    } else if (dealerResult.score < playerResult.score) {
                                        let loseAmount = bet * playerResult.deng;
                                        winLoss = -loseAmount;
                                        userTotalReturn += (singleHolding - loseAmount);
                                    } else {
                                        winLoss = 0;
                                        userTotalReturn += singleHolding;
                                    }
                                }

                                totalWinLoss += winLoss;
                                let legSign = winLoss > 0 ? `+${winLoss.toFixed(0)}` : (winLoss === 0 ? `เสมอ` : `${winLoss.toFixed(0)}`);
                                legDetailsText += `   ▪️ ${legLabel}: ${legSign} บ.\n`;
                            }

                            pUser.balance += userTotalReturn;
                            
                            let winLossSign = totalWinLoss > 0 ? `+${totalWinLoss.toFixed(0)}` : (totalWinLoss === 0 ? `เสมอ (0)` : `${totalWinLoss.toFixed(0)}`);
                            let displayName = pUser.name !== "ผู้เล่นทั่วไป" ? ` (@${pUser.name})` : "";
                            
                            summaryText += `👤 ${pUser.memberTitle}${displayName}:\n${legDetailsText}   🏆 ผลรวมรอบนี้: **${winLossSign} บาท**\n   💳 ยอดเงินคงเหลือล่าสุด: ${pUser.balance} บาท\n------------------------\n`;
                        }

                        replyMsg = summaryText + `✨ เคลียร์ยอดระบบเรียบร้อย พิมพ์ O เพื่อเริ่มรอบใหม่ครับ`;
                        roundBets = {}; 
                        pendingResults = null; 
                    }
                }
                else if (userMsg === 'no') {
                    if (!isAdmin) {
                        replyMsg = `${mentionText} ❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ`;
                    } else if (!pendingResults) {
                        replyMsg = `👑 [แอดมิน] ⚠️ ไม่มีผลไพ่ค้างในระบบให้ยกเลิกครับ`;
                    } else {
                        pendingResults = null; 
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
