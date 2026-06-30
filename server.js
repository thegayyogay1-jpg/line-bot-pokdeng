const express = require('express');
const app = express();
app.use(express.json());

app.post('/callback', async (req, res) => {
    const events = req.body.events;
    if (!events) return res.sendStatus(200);

    for (let event of events) {
        if (event.type === 'message' && event.message.type === 'text') {
            const replyToken = event.replyToken;
            const userMsg = event.message.text.trim().toLowerCase().replace(/\s+/g, '');
            let replyMsg = "";

            // 1. แพทเทิร์น มข-20 (เล่นทุกขา ขาละ...)
            if (userMsg.startsWith('มข-')) {
                const bet = parseInt(userMsg.replace('มข-', ''));
                if (!isNaN(bet)) {
                    const totalBet = bet * 7;
                    const holding = totalBet * 2; // หัก 2 เท่า
                    replyMsg = `🎲 [จดโพย] ทุกขา (1-7) สู้เจ้า ขาละ ${bet} บาท\n💰 ยอดแทงรวม: ${totalBet} บาท\n🔒 หักค้ำประกันวงเงิน (เผื่อ 2 เด้ง): ${holding} บาท`;
                }
            }
            // 2. แพทเทิร์น มจ-100 (เอาเจ้าสู้ทุกขา ขาละ...)
            else if (userMsg.startsWith('มจ-')) {
                const bet = parseInt(userMsg.replace('มจ-', ''));
                if (!isNaN(bet)) {
                    const totalBet = bet * 7;
                    const holding = totalBet * 2; // เจ้ามือค้ำ 2 เท่าของทุกขา
                    replyMsg = `👑 [จดโพย] เจ้ามือ สู้กับทุกขา (1-7) ขาละ ${bet} บาท\n💰 ยอดรวมสู้: ${totalBet} บาท\n🔒 เจ้ามือต้องค้ำประกันรวม: ${holding} บาท`;
                }
            }
            // 3. แพทเทิร์น จ1-50 (เจ้าสู้รายขา)
            else if (userMsg.startsWith('จ')) {
                const parts = userMsg.substring(1).split('-');
                if (parts.length === 2) {
                    const khas = parts[0].split('');
                    const bet = parseInt(parts[1]);
                    if (!isNaN(bet)) {
                        const formattedKhas = khas.map(k => `ขา ${k}`).join(', ');
                        const totalBet = bet * khas.length;
                        const holding = totalBet * 2;
                        replyMsg = `👑 [จดโพย] เจ้ามือ สู้กับ ${formattedKhas} ราคา ขาละ ${bet} บาท\n🔒 เจ้ามือค้ำประกันรอบนี้: ${holding} บาท`;
                    }
                }
            }
            // 4. แพทเทิร์น 1-100 หรือ 123-50 (ขาสู้เจ้าเดี่ยว/ควบ)
            else if (userMsg.includes('-')) {
                const parts = userMsg.split('-');
                if (parts.length === 2 && !isNaN(parts[0])) {
                    const khas = parts[0].split('');
                    const bet = parseInt(parts[1]);
                    if (!isNaN(bet)) {
                        const formattedKhas = khas.map(k => `ขา ${k}`).join(', ');
                        const totalBet = bet * khas.length;
                        const holding = totalBet * 2; // หัก 2 เท่าเผื่อแพ้เด้ง
                        
                        replyMsg = `🎯 [จดโพย] ${formattedKhas} สู้เจ้า ขาละ ${bet} บาท`;
                        replyMsg += `\n🔒 หักค้ำประกันรวม (เผื่อ 2 เด้ง): ${holding} บาท`;
                    }
                }
            }
            // เมนูวิธีเล่น/สรุปผล (สำหรับสเต็ปถัดไป)
            else if (userMsg === 'hello' || userMsg === 'test') {
                replyMsg = "บอทป๊อกเด้ง (ระบบค้ำประกัน 2 เด้ง + หักตังค์เจ้ามือ 10%) พร้อมทำงานครับ!";
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
