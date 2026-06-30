const express = require('express');
const app = express();
app.use(express.json());

app.post('/callback', async (req, res) => {
    const events = req.body.events;
    if (!events) return res.sendStatus(200);

    for (let event of events) {
        if (event.type === 'message' && event.message.type === 'text') {
            const replyToken = event.replyToken;
            const userMsg = event.message.text.trim();
            let replyMsg = "";

            if (userMsg.toLowerCase() === 'hello' || userMsg.toLowerCase() === 'test') {
                replyMsg = "บอทป๊อกเด้งเวอร์ชัน GitHub ตื่นแล้วครับ! ลองพิมพ์ แทง 100 ดูได้เลย";
            } else if (userMsg.includes('แทง')) {
                const money = userMsg.replace(/[^0-9]/g, '');
                replyMsg = `🎯 บอทได้รับยอดแทงเรียบร้อย: ${money} บาท`;
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
                    console.error('Error sending to LINE:', err);
                }
            }
        }
    }
    res.sendStatus(200);
});

app.get('/', (req, res) => res.send('Bot is online!'));

app.listen(process.env.PORT || 3000, () => {
    console.log('Server is running perfectly...');
});
