const express = require('express');
const app = express();
app.use(express.json());

// ตัวแปรเก็บสถานะระบบและข้อมูลโพย
let isRoundOpen = false; // สถานะเปิด-ปิดรอบ
let currentGame = {
    khas: {}, 
    dealerBetAll: 0,
    dealerKhas: {} 
};

// ฟังก์ชันคำนวณแต้มและเด้ง
function parseCard(cardStr) {
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

// ฟังก์ชันช่วยจัดข้อความสรุปโพยปัจจุบัน
function getPoSummary() {
    let text = "📋 [สรุปยอดโพยในรอบนี้]\n";
    let hasData = false;

    if (currentGame.dealerBetAll > 0) {
        text += `👑 เจ้ามือ: สู้ทุกขา ขาละ ${currentGame.dealerBetAll} บาท\n`;
        hasData = true;
    }

    for (let i = 1; i <= 7; i++) {
        if (currentGame.khas[i]) {
            text += `🔹 ขา ${i}: แทง ${currentGame.khas[i]} บาท (ค้ำ ${currentGame.khas[i] * 2} บ.)\n`;
            hasData = true;
        }
        if (currentGame.dealerKhas[i]) {
            text += `👑 เจ้ามือสู้ ขา ${i}: ${currentGame.dealerKhas[i]} บาท (ค้ำ ${currentGame.dealerKhas[i] * 2} บ.)\n`;
            hasData = true;
        }
    }

    if (!hasData) text += "❌ ยังไม่มีใครลงเดิมพันในรอบนี้\n";
    return text;
}

app.post('/callback', async (req, res) => {
    const events = req.body.events;
    if (!events) return res.sendStatus(200);

    for (let event of events) {
        if (event.type === 'message' && event.message.type === 'text') {
            const replyToken = event.replyToken;
            const originalMsg = event.message.text.trim();
            const userMsg = originalMsg.toLowerCase().replace(/\s+/g, '');
            let replyMsg = "";

            // ==========================================
            // PART 1: คำสั่งระบบ เปิดรอบ (O) / ปิดรอบ (X)
            // ==========================================
            if (userMsg === 'o') {
                isRoundOpen = true;
                currentGame = { khas: {}, dealerBetAll: 0, dealerKhas: {} }; // รีเซ็ตกระดานใหม่
                replyMsg = "🟢 [ระบบ] เปิดรับเดิมพันแล้ว! ส่งโพยเข้ามาได้เลยครับ (เช่น 123-50, มข-20)";
            }
            else if (userMsg === 'x') {
                if (!isRoundOpen) {
                    replyMsg = "⚠️ รอบเดิมพันปิดอยู่แล้วครับ พิมพ์ O เพื่อเปิดรอบ";
                } else {
                    isRoundOpen = false; // ปิดล็อกระบบ
                    replyMsg = `🔴 [ระบบ] ปิดรับเดิมพันประจำรอบแล้ว!\n\n${getPoSummary()}\n⏳ รอเจ้ามือสรุปผลไพ่ โดยพิมพ์ 'ผล: [ไพ่เจ้า],[ไพ่ขา1]...'`;
                }
            }

            // ==========================================
            // PART 2: ตรวจสอบและจดโพย (ต้องเปิดรอบอยู่เท่านั้น)
            // ==========================================
            else if (userMsg.startsWith('มข-') || userMsg.startsWith('มจ-') || userMsg.startsWith('จ') || (userMsg.includes('-') && !userMsg.startsWith('ผล:'))) {
                // ถ้ายังไม่เปิดรอบ หรือปิดรอบไปแล้ว ให้เตือนทันที!
                if (!isRoundOpen) {
                    replyMsg = "❌ [เตือน] ยังไม่ถึงเวลาเปิดรับเดิมพัน หรือระบบปิดรอบไปแล้วครับ! ยอดนี้ไม่นับนะ";
                } else {
                    // ทำงานจดโพยตามปกติ
                    if (userMsg.startsWith('มข-')) {
                        const bet = parseInt(userMsg.replace('มข-', ''));
                        if (!isNaN(bet)) {
                            for(let i=1; i<=7; i++) currentGame.khas[i] = bet;
                            replyMsg = `🎲 [จดโพย] ทุกขา (1-7) สู้เจ้า ขาละ ${bet} บาท\n🔒 หักค้ำประกันวงเงิน: ${bet * 7 * 2} บาท`;
                        }
                    }
                    else if (userMsg.startsWith('มจ-')) {
                        const bet = parseInt(userMsg.replace('มจ-', ''));
                        if (!isNaN(bet)) {
                            currentGame.dealerBetAll = bet;
                            replyMsg = `👑 [จดโพย] เจ้ามือ สู้ทุกขา (1-7) ขาละ ${bet} บาท\n🔒 เจ้ามือต้องค้ำประกันรวม: ${bet * 7 * 2} บาท`;
                        }
                    }
                    else if (userMsg.startsWith('จ')) {
                        const parts = userMsg.substring(1).split('-');
                        if (parts.length === 2) {
                            const khas = parts[0].split('');
                            const bet = parseInt(parts[1]);
                            if (!isNaN(bet)) {
                                khas.forEach(k => { currentGame.dealerKhas[k] = bet; });
                                replyMsg = `👑 [จดโพย] เจ้ามือ สู้กับ ขา ${khas.join(', ')} ราคาขาละ ${bet} บาท\n🔒 เจ้ามือค้ำประกัน: ${bet * khas.length * 2} บาท`;
                            }
                        }
                    }
                    else if (userMsg.includes('-')) {
                        const parts = userMsg.split('-');
                        if (parts.length === 2 && !isNaN(parts[0])) {
                            const khas = parts[0].split('');
                            const bet = parseInt(parts[1]);
                            if (!isNaN(bet)) {
                                khas.forEach(k => { currentGame.khas[k] = bet; });
                                replyMsg = `🎯 [จดโพย] ขา ${khas.join(', ')} สู้เจ้า ขาละ ${bet} บาท\n🔒 หักค้ำประกันรวม (เผื่อ 2 เด้ง): ${bet * khas.length * 2} บาท`;
                            }
                        }
                    }
                }
            }
            
            // ==========================================
            // PART 3: ระบบคิดเงินเมื่อส่งผล (ส่งได้แม้จะปิดรอบแล้ว)
            // ==========================================
            else if (originalMsg.startsWith('ผล:') || originalMsg.startsWith('ผล ')) {
                const resultStr = originalMsg.replace(/^ผล:\s*|^ผล\s+/i, '');
                const results = resultStr.split(',');
                
                if (results.length >= 2) {
                    let dealerResult = parseCard(results[0]);
                    let summaryText = `📊 [สรุปผลคิดเงินป๊อกเด้ง]\n👑 เจ้ามือได้: ${dealerResult.score} แต้ม (${dealerResult.deng} เด้ง)\n------------------------\n`;
                    
                    for (let i = 1; i < results.length && i <= 7; i++) {
                        let playerResult = parseCard(results[i]);
                        let bet = currentGame.khas[i] || currentGame.dealerBetAll || currentGame.dealerKhas[i] || 0;
                        let isDealerSide = currentGame.dealerBetAll > 0 || currentGame.dealerKhas[i] > 0;
                        
                        if (bet === 0) {
                            summaryText += `🔹 ขา ${i}: ไม่ได้ลงเดิมพัน\n`;
                            continue;
                        }

                        let holdingMoney = bet * 2;
                        let finalChange = 0;
                        let winLossText = "";

                        if (playerResult.score > dealerResult.score) {
                            let winAmount = bet * playerResult.deng;
                            finalChange = isDealerSide ? 0 : (holdingMoney + winAmount);
                            winLossText = isDealerSide ? `❌ เจ้าแพ้ เสีย ${winAmount} บาท` : `🎉 ชนะ ได้ +${winAmount} บาท (คืนค้ำเต็ม)`;
                        } 
                        else if (playerResult.score < dealerResult.score) {
                            let loseAmount = bet * dealerResult.deng;
                            if (isDealerSide) {
                                let profit = loseAmount * 0.9;
                                finalChange = holdingMoney + profit;
                                winLossText = `👑 เจ้าชนะ ได้ +${profit} บาท (หักน้ำ 10%)`;
                            } else {
                                finalChange = holdingMoney - loseAmount;
                                winLossText = `💸 แพ้ เสีย -${loseAmount} บาท (คืนเศษค้ำ ${finalChange} บ.)`;
                            }
                        } 
                        else {
                            if (playerResult.deng > dealerResult.deng) {
                                let winAmount = bet * (playerResult.deng - dealerResult.deng);
                                finalChange = holdingMoney + winAmount;
                                winLossText = `🎉 ชนะเด้ง ได้ +${winAmount} บาท`;
                            } else if (playerResult.deng < dealerResult.deng) {
                                let loseAmount = bet * (dealerResult.deng - playerResult.deng);
                                finalChange = holdingMoney - loseAmount;
                                winLossText = `💸 แพ้เด้ง เสีย -${loseAmount} บาท`;
                            } else {
                                finalChange = holdingMoney;
                                winLossText = `🤝 เจ๊า เสมอคืนทุน (คืนค้ำเต็ม)`;
                            }
                        }
                        summaryText += `🔹 ขา ${i} [${playerResult.score}แต้ม ${playerResult.deng}เด้ง]: ${winLossText}\n`;
                    }
                    replyMsg = summaryText + `\n✨ จบรอบเรียบร้อย หากจะเล่นตาถัดไปให้พิมพ์ O เพื่อเปิดรอบใหม่ครับ`;
                    currentGame = { khas: {}, dealerBetAll: 0, dealerKhas: {} }; // รีเซ็ตข้อมูลรอรอบหน้า
                }
            }
            else if (userMsg === 'hello' || userMsg === 'test') {
                replyMsg = "บอทป๊อกเด้งระบบ เปิด(O) / ปิด(X) รอบเดิมพัน พร้อมมวยครับ!";
            }

            // ส่งข้อความกลับไปที่ LINE
            if (replyMsg) {
                try {
                    await fetch('https://api.line.me/v2/bot/message/reply', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
                        },
                        body: JSON.stringify({ replyToken: replyToken, messages: [{ type: 'text', text: replyMsg }] })
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
