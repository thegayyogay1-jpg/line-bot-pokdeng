const express = require('express');
const axios = require('axios');
const fs = require('fs'); // 📁 เติมตรงนี้เพื่อให้ระบบรู้จักการเขียนไฟล์ลงเครื่องครับน้า
const app = express();
app.use(express.json());
global.currentReplyFlex = null; // 👈 แทรกบรรทัดนี้ลงไปตรงนี้ครับ

// 💡 ไม่ต้องใส่ Token ในนี้แล้ว ระบบจะดึงจากตัวแปรบน Render อัตโนมัติ
const TOKEN = process.env.CHANNEL_ACCESS_TOKEN;

// 👥 [กล่องรวม ID แอดมินกลาง] มีแอดมินเพิ่มมาใส่เพิ่มตรงนี้ที่เดียวจบเลยครับน้า!
const ADMIN_IDS = [
    "U2fb9233e5c539ae3970cbd698e2e18db", // แอดมินคนที่ 1
    "Uf48148ba5a3bfd14d4e81213daf56ef4" // แอดมินคนที่ 2
];

// 📡 ลิงก์เชื่อมโยงไปยังฐานข้อมูล Firebase ถาวร 
const FIREBASE_URL = "https://my-pokdeng-bot-default-rtdb.asia-southeast1.firebasedatabase.app/"; 

let usersWallets = {};
let nextMemberId = 1;
let isRoundOpen = false; // ตัวแปรจำสถานะ เปิด/ปิด รอบ
let roundBets = {};      // ตัวแปรสำหรับจำโพยแทงในแต่ละรอบ
let currentRound = 0;    // บรรทัดนี้เพื่อจำลำดับรอบปัจจุบัน
let isDrawOpen = false;  // บรรทัดนี้เพื่อเช็กสถานะรอบจั่วไพ่
let tempRoomResults = null; // ใช้พักข้อมูลผลแต้มชั่วคราวที่แอดมินพึ่งพิมพ์ส่งมา
let tempDealerResult = null; // ใช้พักข้อมูลผลแต้มของเจ้ามือชั่วคราว
let matchHistory = []; // เก็บประวัติสถิติย้อนหลังสูงสุด 5 รอบ
let detailedRoundHistory = {}; // ตัวแปรเก็บข้อมูลสำหรับแอดมินดึงย้อนหลัง
let pastRoundsData = {}; //  ถังเก็บประวัติโพยและผลไพ่แยกรายรอบ (สำหรับดึง v,m)
let withdrawQueue = []; // 📦 ถังสำหรับเก็บคิวสมาชิกที่แจ้งถอนเงิน
let usersRoundCrossCheck = {}; // 🌟 เพิ่มบรรทัดนี้ไว้บนสุดของไฟล์
global.depositQueue = {}; // 👈 เพิ่มบรรทัดนี้เพื่อเตรียมถังคิวฝากเงินออโต้ไม่ให้เป็นค่าว่างครับน้า!
if (!global.satangCounter) global.satangCounter = 0;

// 🔄 ฟังก์ชันอัตโนมัติ: ดึงข้อมูลจาก Firebase มาอัปเดตลงในบอททันทีที่เปิดเครื่อง (แก้ไขดึงครบทุกกล่องแล้ว)
async function loadDataFromFirebase() {
    try {
        const response = await axios.get(`${FIREBASE_URL}system_data.json`);
        if (response.data) {
            usersWallets = response.data.usersWallets || {};
            nextMemberId = response.data.nextMemberId || 1;
            isRoundOpen = response.data.isRoundOpen !== undefined ? response.data.isRoundOpen : false;
            roundBets = response.data.roundBets || {};
            currentRound = response.data.currentRound || 0;
            isDrawOpen = response.data.isDrawOpen !== undefined ? response.data.isDrawOpen : false;
            matchHistory = response.data.matchHistory || [];
            detailedRoundHistory = response.data.detailedRoundHistory || {};
            pastRoundsData = response.data.pastRoundsData || {};
            withdrawQueue = response.data.withdrawQueue || [];
            console.log("✅ ดึงข้อมูลระบบทั้งหมดจาก Firebase สำเร็จเรียบร้อย!");
        }
    } catch (error) {
        console.error("❌ ไม่สามารถดึงข้อมูลจาก Firebase ได้:", error.message);
    }
}
loadDataFromFirebase(); // สั่งให้ทำงานทันทีที่บอทรัน

// 🤖 [ระบบฝากออโต้] ฟังก์ชันตรวจสอบยอดเงินจากเศษสตางค์
async function checkAutoDeposit() {
    if (!global.depositQueue) return;
    
    try {
        // 💡 ดึงข้อมูล Statement ล่าสุดของน้าจาก API หรือจุดเช็กยอดโอน (ตัวอย่างจำลองสถานการณ์)
        // const response = await axios.get('ลิงก์_API_เช็กยอดโอนของน้า');
        // const bankTransactions = response.data.transactions || [];
        
        const bankTransactions = global.bankTransactions || []; // 📝 เปลี่ยนเป็นข้อมูลสเตทเม้นท์จริงที่ดึงได้นะน้า

        for (let userId in global.depositQueue) {
            const queue = global.depositQueue[userId];

            if (!queue || queue.status !== 'WAITING_ADMIN') continue;

            // 🔍 ค้นหาในรายการโอนเงินว่ามียอดเงิน + เศษสตางค์ที่ตรงกับคิวไหม
            const matchIndex = bankTransactions.findIndex(tx => 
                parseFloat(tx.amount).toFixed(2) === parseFloat(queue.displayAmount).toFixed(2)
            );

            // 💰 2. ถ้ามียอดโอนตรงกับเศษสตางค์ที่กำหนดไว้
            if (matchIndex !== -1) {
                const user = usersWallets[userId];

                if (user) {
                    // 2.1 เติมเครดิตเข้ากระเป๋าผู้ใช้ทันที
                    user.balance = (user.balance || 0) + Number(queue.rawAmount);

                    // 2.2 เซฟข้อมูลถาวรลง Firebase
                    await saveDataToFirebase();

                    // 2.3 ลบลายเซ็นรายการโอนนี้ออกจาก bankTransactions (กันสแกนซ้ำ)
                    bankTransactions.splice(matchIndex, 1);

                    // 2.4 ล้างคิวฝากของยูสเซอร์รายนี้ออก
                    delete global.depositQueue[userId];

                    // 📝 แสดง Log ใน Server ให้แอดมินรู้ว่าเติมเรียบร้อยแล้ว
                    console.log(`✅ [เติมเงียบสำเร็จ] ยูสเซอร์ [${user.memberNumber || '-'}] ${user.nickname || user.name} | ยอด ${queue.displayAmount} ฿ -> เครดิตใหม่: ${user.balance} ฿`);
                }
            }
        }
    } catch (err) {
        console.error("❌ ระบบตรวจสอบฝากออโต้ผิดพลาด:", err.message);
    }
}

// ⏱️ สั่งให้ระบบลูปตรวจสอบทุกๆ 10-30 วินาทีอัตโนมัติ
setInterval(checkAutoDeposit, 15000);


// 💾 ฟังก์ชันอัตโนมัติ: สั่งบันทึกข้อมูลปัจจุบันยิงกลับไปเก็บที่ตึก Firebase
async function saveDataToFirebase() {
    try {
        await axios.put(`${FIREBASE_URL}system_data.json`, {
            usersWallets: usersWallets,
            nextMemberId: nextMemberId,
            isRoundOpen: isRoundOpen,         // 💾 จำสถานะ เปิด/ปิด รอบ
            roundBets: roundBets,             // 💾 จำโพยแทงในแต่ละรอบ
            currentRound: currentRound,       // 💾 จำลำดับรอบปัจจุบัน
            isDrawOpen: isDrawOpen,           // 💾 จำสถานะรอบจั่วไพ่
            matchHistory: matchHistory,       // 💾 จำประวัติสถิติย้อนหลัง 5 รอบ
            detailedRoundHistory: detailedRoundHistory, // 💾 จำข้อมูลแอดมินดึงย้อนหลัง
            pastRoundsData: pastRoundsData,   // 💾 จำประวัติโพยและผลไพ่แยกรายรอบ (v,m)
            withdrawQueue: withdrawQueue       // 💾 จำคิวสมาชิกที่แจ้งถอนเงิน
        });
        console.log("💾 บันทึกข้อมูลลง Firebase เรียบร้อย!");
    } catch (error) {
        console.error("❌ บันทึกข้อมูลลง Firebase ล้มเหลว:", error.message);
    }
}
app.post('/callback', async (req, res) => {
    const events = req.body.events;
    if (!events) return res.sendStatus(200);

    for (let event of events) {
      // =================================================================
        // 📸 [ระบบฟิวชั่น ร่างอัปเกรดเตือนภัย] ดักจับรูปภาพสลิป + เตือนแอดมินถ้าส่งช้าเกิน 5 นาที
        // =================================================================
        if (event.type === 'message' && event.message.type === 'image') {
            const replyToken = event.replyToken;
            const userId = event.source.userId;

            if (global.depositQueue && global.depositQueue[userId] && global.depositQueue[userId].status === 'WAITING_ADMIN') {
                const currentQueue = global.depositQueue[userId];
                const messageId = event.message.id;
                const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db";
                
                // ⏱️ คำนวณเวลาที่ใช้ไปนับตั้งแต่กดฝาก (หน่วยเป็นนาที)
                const timeElapsed = (Date.now() - currentQueue.createdAt) / 1000 / 60;

                // 🚨 สร้างป้ายเตือนภัย ถ้าส่งสลิปช้ากว่า 5 นาที
                let timeWarningTag = "";
                if (timeElapsed > 5) {
                    timeWarningTag = `\n\n⚠️ [แจ้งเตือนภัย] สลิปนี้ส่งเลทเกิน 5 นาทีนะน้า! (ส่งช้าไปประมาณ ${Math.floor(timeElapsed)} นาที) เช็กเวลาโอนบนสลิปและสเตทเม้นท์ให้ดีๆ ก่อนกดเติมเงินครับ!`;
                }

                const filename = `slip-${currentQueue.memberId}.jpg`;

                try {
                    // 📁 1. ดาวน์โหลดรูปภาพสลิปดิบจาก LINE API
                    const response = await axios({
                        method: 'get',
                        url: `https://api-data.line.me/v2/bot/message/${messageId}/content`,
                        responseType: 'stream',
                        headers: { 'Authorization': `Bearer ${TOKEN}` }
                    });

                    // 💾 2. บันทึกรูปภาพลงบนเซิร์ฟเวอร์ Render (ตรรกะเดิมที่ทำงานได้สมบูรณ์แบบห้ามแตะต้อง)
                    const writer = fs.createWriteStream(filename);
                    response.data.pipe(writer);

                    await new Promise((resolve, reject) => {
                        writer.on('finish', resolve);
                        writer.on('error', reject);
                    });

                    const myServerUrl = `https://linepok3p.onrender.com/${filename}`;

                   // 🔔 3. เปลี่ยนจากข้อความธรรมดา เป็นการส่ง Flex Message หาแอดมิน (มีปุ่มกดสะดวกรวดเร็ว)
                    const adminFlexMessage = {
                        "type": "flex",
                        "altText": `🔔 แจ้งโอนเงินจากสมาชิกที่ ${currentQueue.memberId}`,
                        "contents": {
                            "type": "bubble",
                            "size": "giga",
                            "styles": {
                                "header": { "backgroundColor": "#111111" },
                                "body": { "backgroundColor": "#1c1c1c" },
                                "footer": { "backgroundColor": "#111111" }
                            },
                            "header": {
                                "type": "box",
                                "layout": "vertical",
                                "contents": [
                                    { "type": "text", "text": "🔔 มีรายการแจ้งโอนเงินใหม่!", "weight": "bold", "color": "#ffbb00", "size": "md", "align": "center" }
                                ]
                            },
                            "body": {
                                "type": "box",
                                "layout": "vertical",
                                "spacing": "sm",
                                "contents": [
                                    { "type": "text", "text": `🆔 สมาชิกลำดับที่: ${currentQueue.memberId}`, "color": "#ffffff", "size": "sm" },
                                    { "type": "text", "text": `👤 ชื่อ: คุณ ${currentQueue.name}`, "color": "#cccccc", "size": "sm" },
                                    { "type": "text", "text": `💰 ยอดเงินในคิว: ${currentQueue.displayAmount} บาท`, "color": "#00ffcc", "weight": "bold", "size": "md" },
                                    { "type": "separator", "color": "#333333", "margin": "md" },
                                    { "type": "text", "text": "🤖 [ระบบออโต้]: กำลังรอเช็กยอดโอนและเศษสตางค์ตรงกับระบบแจ้งเตือน...", "color": "#888888", "size": "xs", "wrap": true, "margin": "sm" },
                                    { "type": "text", "text": "💡 หากยอดไม่เข้า หรือน้าตรวจสอบแล้วถูกต้อง สามารถใช้ปุ่มลัดด้านล่างเพื่อจัดการแบบแมนนวลได้ทันทีครับ", "color": "#ff8800", "size": "xs", "wrap": true }
                                ]
                            },
                            "footer": {
                                "type": "box",
                                "layout": "vertical",
                                "spacing": "sm",
                                "contents": [
                                    {
                                        "type": "button",
                                        "style": "primary",
                                        "color": "#00aa5b",
                                        "height": "sm",
                                        "action": {
                                            "type": "message",
                                            "label": "✅ เติมเงินปกติ",
                                            "text": `เติม ${currentQueue.memberId} ${currentQueue.rawAmount}`
                                        }
                                    },
                                    {
                                        "type": "button",
                                        "style": "primary",
                                        "color": "#0088cc",
                                        "height": "sm",
                                        "action": {
                                            "type": "message",
                                            "label": "🎁 เติมแบบติดโปร (B)",
                                            "text": `B ${currentQueue.memberId} [ใส่ยอดรวมโบนัสตรงนี้ด้วยนะน้า]`
                                        }
                                    },
                                    {
                                        "type": "button",
                                        "style": "secondary",
                                        "color": "#cc3333",
                                        "height": "sm",
                                        "action": {
                                            "type": "message",
                                            "label": "❌ ปฏิเสธรายการ (cc)",
                                            "text": `cc ${currentQueue.memberId}`
                                        }
                                    }
                                ]
                            }
                        }
                    };

                    // 🚀 4. สั่ง Push ส่งรูปภาพ + Flex Message ที่มีปุ่มกด หาแอดมินพร้อมกัน
                    await axios.post('https://api.line.me/v2/bot/message/push', {
                        to: ADMIN_ID,
                        messages: [
                            { type: 'image', originalContentUrl: myServerUrl, previewImageUrl: myServerUrl },
                            adminFlexMessage // 👈 เปลี่ยนจาก adminNotifyMessage (ข้อความธรรมดา) มาเป็นตัวปุ่มกดนี้แทนครับ
                        ]
                    }, {
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${TOKEN}`
                        }
                    });

                    // 💬 5. ตอบกลับแจ้งสมาชิกฝั่งลูกค้าด้วย Flex Message ธีมธุรกรรมฝากเงินสีเขียวนีออนสุดเท่ 
                    await axios.post('https://api.line.me/v2/bot/message/reply', {
                        replyToken: replyToken,
                        messages: [
                            {
                                "type": "flex",
                                "altText": "✅ ได้รับสลิปเรียบร้อยแล้วค่ะ",
                                "contents": {
                                    "type": "bubble",
                                    "styles": { "body": { "backgroundColor": "#09120e" } },
                                    "body": {
                                        "type": "box",
                                        "layout": "vertical",
                                        "spacing": "md",
                                        "contents": [
                                            { "type": "text", "text": "✅ ได้รับรูปภาพสลิปแล้ว", "weight": "bold", "color": "#00ff88", "size": "md", "align": "center" },
                                            { "type": "separator", "color": "#12251c" },
                                            {
                                                "type": "box",
                                                "layout": "horizontal",
                                                "contents": [
                                                    { "type": "text", "text": "💰 ยอดโอนในคิว:", "size": "sm", "color": "#8caf9c" },
                                                    { "type": "text", "text": `${currentQueue.displayAmount} บาท`, "size": "sm", "color": "#00ff88", "weight": "bold", "align": "end" }
                                                ]
                                            },
                                            { "type": "separator", "color": "#12251c" },
                                            { "type": "text", "text": "⏳ ระบบกำลังตรวจสอบความถูกต้องของสลิปและยอดโอน กรุณารอเครดิตเข้ากระเป๋าสักครู่เดียวค่ะ 🏁", "size": "xs", "color": "#cccccc", "wrap": true, "align": "center" }
                                        ]
                                    }
                                }
                            }
                        ]
                    }, {
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${TOKEN}`
                        }
                    });

                } catch (err) {
                    console.error("❌ ระบบแจ้งเตือนรูปสลิปล้มเหลว:", err.message);
                }
                return res.sendStatus(200); 
            }
            
            return res.sendStatus(200);
        }
        if (event.type === 'message' && event.message.type === 'text') {
            const replyToken = event.replyToken;
            const userId = event.source.userId; 
            const originalMsg = event.message.text.trim(); 
            const userMsg = originalMsg.toLowerCase().replace(/\s+/g, ''); 

            let replyText = ""; 
            const args = originalMsg.split(/\s+/); 
            const command = args[0]; // ดึงคำแรก เช่น เติม หรือ ลบ
        
        // ==================== [ 🤖 ระบบดักจับแจ้งเตือนธนาคารและอัปยอดออโต้ ] ====================
        if (userMsg.includes('kdeposit')) { // ใช้ includes แทน และเช็กจาก userMsg ที่เป็นพิมพ์เล็กหมดแล้ว
            console.log(`🤖 บอทได้รับแจ้งเตือนธนาคารจาก MacroDroid: "${originalMsg}"`);
            
            // 🔍 แกะตัวเลขทศนิยมออกมา เช่น 10.68 จากข้อความจริง (originalMsg)
            const match = originalMsg.match(/([0-9]+\.[0-9]{2})/);
            if (match) {
                const bankAmount = parseFloat(match[1]); // จะได้เลข 10.68 เป็นทศนิยม
                console.log(`🔍 ค้นหาในคิวระบบ ยอดที่ตรงกับ: ${bankAmount} บาท...`);

                // ค้นหาคิวยูสเซอร์ที่มีสถานะรอโอน และยอดตรงกับเศษสตางค์
                let foundUserId = null;
                for (let uId in global.depositQueue) {
                    const queue = global.depositQueue[uId];
                    if (queue.status === 'WAITING_ADMIN' && parseFloat(queue.displayAmount) === bankAmount) {
                        foundUserId = uId;
                        break;
                    }
                }

                if (foundUserId) {
                    const matchedQueue = global.depositQueue[foundUserId];
                    
                    // 💰 1. เติมเครดิตเข้ากระเป๋าของลูกค้า
                    if (usersWallets[foundUserId]) {
                        usersWallets[foundUserId].balance += matchedQueue.rawAmount;
                        
                        console.log(`✅ [จับคู่สำเร็จ] เติมเงินให้สมาชิกที่ ${usersWallets[foundUserId].memberNumber} จำนวน ${matchedQueue.rawAmount} บาท!`);

                        // 🧼 2. ล้างคิวฝากเงินชิ้นนี้ทิ้ง ป้องกันสลิปซ้ำ
                        delete global.depositQueue[foundUserId];

                        // 🎯 [เพิ่มจุดนี้] ถ้าระบบไม่มีคิวฝากค้างอยู่เลย ให้รีเซ็ตเศษสตางค์กลับไปเริ่ม 0.01 ใหม่
                        if (Object.keys(global.depositQueue).length === 0) {
                            global.satangCounter = 0;
                        }

                        // 💾 3. บันทึกลง Firebase ถาวรทันที
                        await saveDataToFirebase();
                        
                    } else {
                        console.log(`⚠️ พบยอดโอนตรงในคิว แต่ยูสเซอร์ ${foundUserId} ไม่มีกระเป๋าเงินในระบบ`);
                    }
                } else {
                    console.log(`❌ ไม่พบใบสั่งฝากเงินในระบบที่ตรงกับยอด ${bankAmount} บาท`);
                }
            }
            return res.sendStatus(200); // 👈 แก้ตรงนี้! ส่ง Status 200 กลับหาเว็บฮุกทันทีโดยตรง ไม่รันต่อให้เกิดบั๊กสลิปซ้ำ
        }

            // ==================== [ 1. ระบบเติมเงิน/ลบเงิน ] ====================
            if (command === "เติม" || command === "ลบ") {
                // 🚨 เปลี่ยนตรงนี้: เช็กว่า ID คนพิมพ์อยู่ในกล่องแอดมินไหม
                if (!ADMIN_IDS.includes(userId)) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
                } else {
                    const targetMemberId = parseInt(args[1]); 
                    const amount = parseFloat(args[2]);      

                    if (!targetMemberId || isNaN(amount) || amount <= 0) {
                        replyText = `⚠️ รูปแบบคำสั่งไม่ถูกต้อง\nกรุณาพิมพ์: เติม [เลขสมาชิก] [จำนวนเงิน]\n(ตัวอย่าง: เติม 1 2000 หรือ ลบ 1 2000)`;
                    } else {
                        let foundUserKey = null;
                        for (let key in usersWallets) {
                            if (usersWallets[key].memberNumber === targetMemberId) {
                                foundUserKey = key;
                                break;
                            }
                        }

                        if (!foundUserKey) {
                            replyText = `❌ ไม่พบเลขสมาชิกที่ ${targetMemberId} ในระบบครับ`;
                        } else {
                            if (command === "เติม") {
                                // 🚨 [ดักคนเหลี่ยม] เช็กก่อนว่าสมาชิกคนนี้ได้พิมพ์ "ฝาก" เพื่อเปิดยอดฝากไว้จริงไหม
                                if (!global.depositQueue || !global.depositQueue[foundUserKey] || global.depositQueue[foundUserKey].status !== 'WAITING_ADMIN') {
                                    replyText = `❌ เติมเงินไม่สำเร็จ! \n สมาชิกเลข ${targetMemberId} ยังไม่ได้พิมพ์ฝากเข้ามาในระบบ หรือยอดนี้เคยเติมไป`;
                                } else {
                                    usersWallets[foundUserKey].balance += amount;
                                    const user = usersWallets[foundUserKey];
                                    
                                    // 🧼 ล้างคิวฝากทิ้งทันที
                                    delete global.depositQueue[foundUserKey]; 

                                    // 🎯 [เพิ่มจุดนี้] ถ้าระบบไม่มีคิวฝากค้างอยู่เลย ให้รีเซ็ตเศษสตางค์กลับไปเริ่ม 0.01 ใหม่
                                    if (Object.keys(global.depositQueue).length === 0) {
                                        global.satangCounter = 0;
                                     }

                                    await saveDataToFirebase(); 
                                    replyText = `💰 เติมเครดิตสมาชิกที่ ${user.memberNumber} \n คุณ ${user.name} +${amount} สำเร็จ!\n──────────────────\nยอดสุทธิ: ${user.balance} บาท`;
                                }
                            } else if (command === "ลบ") {
                                usersWallets[foundUserKey].balance -= amount;
                                const user = usersWallets[foundUserKey];
                                await saveDataToFirebase(); 
                                replyText = `🚨 ลบยอดเครดิตสมาชิกที่ ${user.memberNumber} \n คุณ ${user.name} -${amount}!\n──────────────────\nยอดปัจจุบัน: ${user.balance} บาท`;
                            }
                        }
                    }
                }
            }
// ==================== [ ระบบเติมเงินแบบติดโปรโบนัสคูณ 20 (B เลขสมาชิก จำนวนเงิน) ] ====================
            else if (command === "B" || command === "b") {
                // 🚨 เช็กว่า ID คนพิมพ์อยู่ในกล่องแอดมินไหม
                if (!ADMIN_IDS.includes(userId)) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
                } else {
                    const targetMemberId = parseInt(args[1]);
                    const amount = parseFloat(args[2]); 

                    if (!targetMemberId || isNaN(amount) || amount <= 0) {
                        replyText = `⚠️ รูปแบบโปรโบนัสไม่ถูกต้อง\nกรุณาพิมพ์: B [เลขสมาชิก] [ยอดรวมรวมโบนัส]\n(ตัวอย่าง: B 1 200)`;
                    } else {
                        let foundUserKey = null;
                        for (let key in usersWallets) {
                            if (usersWallets[key].memberNumber === targetMemberId) {
                                foundUserKey = key;
                                break;
                            }
                        }

                        if (!foundUserKey) {
                            replyText = `❌ ไม่พบเลขสมาชิกที่ ${targetMemberId} ในระบบครับ`;
                        } else {
                            // 🚨 [ดักคนเหลี่ยม] เช็กคิวฝากเงินก่อนให้โปรโบนัส
                            if (!global.depositQueue || !global.depositQueue[foundUserKey] || global.depositQueue[foundUserKey].status !== 'WAITING_ADMIN') {
                                replyText = `❌ เติมโบนัสไม่สำเร็จ! สมาชิกหมายเลข ${targetMemberId} ยังไม่ได้พิมพ์เปิดยอดฝากเข้ามาในระบบ หรือยอดนี้เคยถูกเติมไปแล้วครับน้า`;
                            } else {
                                const user = usersWallets[foundUserKey];
                                user.balance += amount;

                                // 🔄 คำนวณยอดเทิร์นใหม่ของบิลนี้
                                let newTurnoverTarget = amount * 20; 

                                // 📊 ดึงยอดเทิร์นเดิมมาเช็ก ถ้าไม่มีหรือเป็นค่าว่างให้เริ่มต้นจาก 0 แล้วบวกทบเข้าไป
                                let currentTurnover = user.turnoverTarget;
                                if (!currentTurnover || isNaN(currentTurnover)) {
                                    currentTurnover = 0;
                                }
                                user.turnoverTarget = currentTurnover + newTurnoverTarget;
                                
                                // 🧼 ล้างคิวฝากทิ้งทันที
                                delete global.depositQueue[foundUserKey];
                                await saveDataToFirebase();

                                replyText = `🎁 เติมโบนัสให้สมาชิกที่ [ ${user.memberNumber} ] \n คุณ ${user.name} สำเร็จ!\n──────────────────\n` +
                                            `💰 ยอดสุทธิ: +${amount} บาท\n──────────────────\n` +
                                            `🔒 เงื่อนไข ต้องทำยอดเทิร์นสะสม (ได้/เสีย) เพิ่ม: +${newTurnoverTarget} บาท\n` +
                                            `📊 ยอดเทิร์นคงเหลือรวมทั้งหมด: ${user.turnoverTarget} บาท`;
                            }
                        }
                    }
                }
            }
                // ==================== [ 🧼 คำสั่งแอดมินพิเศษ: ล้างยอดเทิร์นโอเวอร์สมาชิก (พิมพ์: bb [เลขสมาชิก]) ] ====================
            else if (command === "Bb" || command === "bb") {
                // 👥 เช็กสิทธิ์แอดมินจากกล่องรวมกลาง
                if (!ADMIN_IDS.includes(userId)) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
                } else {
                    const targetMemberId = parseInt(args[1]);

                    if (!targetMemberId || isNaN(targetMemberId)) {
                        replyText = `⚠️ รูปแบบคำสั่งไม่ถูกต้องน้า\nกรุณาพิมพ์: bb [เลขสมาชิก]\n(ตัวอย่างเช่น: bb 1)`;
                    } else {
                        let foundUserKey = null;
                        for (let key in usersWallets) {
                            if (usersWallets[key].memberNumber === targetMemberId) {
                                foundUserKey = key;
                                break;
                            }
                        }

                        if (!foundUserKey) {
                            replyText = `❌ ไม่พบเลขสมาชิกที่ ${targetMemberId} ในระบบครับน้า`;
                        } else {
                            const user = usersWallets[foundUserKey];
                            
                            // 🧼 เคลียร์ยอดเทิร์นค้างเก่าทั้งหมดให้เป็น 0 ชัวร์ ๆ
                            user.turnoverTarget = 0;
                            
                            // 💾 บันทึกการเปลี่ยนแปลงลง Firebase ถาวร
                            await saveDataToFirebase();

                            replyText = `🧼 [ระบบล้างยอดเทิร์นโอเวอร์] \n👤 คุณ ${user.name} (สมาชิกที่ ${user.memberNumber})\n✅ ทำการล้างยอดเทิร์นค้างเก่าทั้งหมดสำเร็จแล้วครับ!\n──────────────────\n📊 ยอดเทิร์นคงเหลือที่ต้องทำ: 0 บาท\n💰 เครดิตคงเหลือในกระเป๋า: ${user.balance} บาท`;
                        }
                    }
                }
            }
// =================================================================
// ❌ [คำสั่งแอดมิน] ยกเลิกคิวแจ้งฝากเงิน (พิมพ์: cc [เลขสมาชิก])
// =================================================================
            else if (command === "cc" || command === "Cc" || command === "CC") {
                // 🚨 เปลี่ยนตรงนี้: เช็กว่า ID คนพิมพ์อยู่ในกล่องแอดมินไหม
                if (!ADMIN_IDS.includes(userId)) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
                } else {
                    const targetMemberId = parseInt(args[1]); // ดึงเลขสมาชิกจากช่องที่สอง เช่น cc 1

                    if (!targetMemberId || isNaN(targetMemberId)) {
                        replyText = "❌ รูปแบบผิดครับน้า! ต้องพิมพ์เช่น: cc [เลขสมาชิก] (ตัวอย่าง: cc 12)";
                    } else {
                        // ค้นหาในคิวฝากว่า เลขสมาชิกนี้ตรงกับ userId ไหนในระบบ RAM
                        let foundUserKey = null;

                        if (global.depositQueue) {
                            for (let key in global.depositQueue) {
                                if (global.depositQueue[key].memberId === targetMemberId) {
                                    foundUserKey = key;
                                    break;
                                }
                            }
                        }

                        // 🧼 ถ้าเจอคิว ให้ทำการลบออกจากระบบทันที
                        if (foundUserKey) {
                            const currentQueue = global.depositQueue[foundUserKey];
                            delete global.depositQueue[foundUserKey]; // ล้างคิวออกจาก RAM
                            
                            replyText = `❌ [แอดมินสั่งยกเลิก] ทำการยกเลิกและล้างคิวฝากของ สมาชิกลำดับที่: ${targetMemberId} เรียบร้อยแล้วครับน้า!`;

                            // 💬 ส่งข้อความไปเตือนฝั่งลูกค้าให้รู้ตัวด้วยว่าโดนปฏิเสธคิว
                            try {
                                await axios.post('https://api.line.me/v2/bot/message/push', {
                                    to: foundUserKey,
                                    messages: [{ 
                                        type: 'text', 
                                        text: `❌ รายการแจ้งฝากยอดเงินของถูกปฏิเสธ/ยกเลิกโดยแอดมินครับ\n\n⚠️ เหตุผล: สลิปไม่ถูกต้อง หรือยอดเงินไม่ตรง\n👉 หากต้องการทำรายการใหม่ กรุณาพิมพ์คำสั่ง "ฝาก [ยอดเงิน]" อีกครั้ง\n────────────────\nหรือติดต่อแอดมิน\n🔻🔻🔻🔻\nhttps://lin.ee/ySA60EA` 
                                    }]
                                }, {
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Authorization': `Bearer ${TOKEN}`
                                    }
                                });
                            } catch (err) {
                                console.error("❌ ส่งข้อความแจ้งยกเลิกหาลูกค้าล้มเหลว:", err.message);
                            }

                        } else {
                            replyText = `❌ ไม่พบรายการคิวฝากค้างในระบบที่ตรงกับสมาชิกลำดับที่ ${targetMemberId} ครับน้า เช็กตัวเลขดีๆ อีกทีครับ`;
                        }
                    }
                }
            }
             // ==================== [ 🛠️ คำสั่งแอดมินพิเศษ: เติมเครดิตฉุกเฉิน/แจกทุน+ติดเทิร์น (พิมพ์: @ [เลขสมาชิก] [จำนวนเงิน] หรือ @ [เลขสมาชิก] [จำนวนเงิน]#[ยอดเทิร์น]) ] ====================
            else if (command === "@") {
                // 👥 เช็กสิทธิ์แอดมินจากกล่องรวมกลาง
                if (!ADMIN_IDS.includes(userId)) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
                } else {
                    const targetMemberId = parseInt(args[1]);
                    let rawAmountStr = args[2] ? args[2].toString() : "";      

                    if (!targetMemberId || !rawAmountStr) {
                        replyText = `⚠️ รูปแบบคำสั่งไม่ถูกต้องน้า\n👉 เติมปกติ: @ [เลขสมาชิก] [จำนวนเงิน] (เช่น: @ 1 200)\n👉 แจกทุนติดเทิร์น: @ [เลขสมาชิก] [จำนวนเงิน]#[ยอดเทิร์น] (เช่น: @ 1 200#1000)`;
                    } else {
                        let amount = 0;
                        let turnoverRequirement = 0;

                        // 🔍 ตรวจสอบว่ามีการใส่สัญลักษณ์ # เพื่อกำหนดเทิร์นโอเวอร์ไหม
                        if (rawAmountStr.includes('#')) {
                            const parts = rawAmountStr.split('#');
                            amount = parseFloat(parts[0]);
                            turnoverRequirement = parseFloat(parts[1]);
                        } else {
                            amount = parseFloat(rawAmountStr);
                        }

                        if (isNaN(amount) || amount <= 0 || isNaN(turnoverRequirement) || turnoverRequirement < 0) {
                            replyText = `⚠️ จำนวนเงิน หรือยอดเทิร์นโอเวอร์ไม่ถูกต้องครับน้า กรุณาเช็กตัวเลขอีกครั้งครับ`;
                        } else {
                            let foundUserKey = null;
                            for (let key in usersWallets) {
                                if (usersWallets[key].memberNumber === targetMemberId) {
                                    foundUserKey = key;
                                    break;
                                }
                            }

                            if (!foundUserKey) {
                                replyText = `❌ ไม่พบเลขสมาชิกที่ ${targetMemberId} ในระบบครับน้า`;
                            } else {
                                // 🚀 บวกเงินเข้ากระเป๋าทันที ทะลุทุกระบบล็อก!
                                usersWallets[foundUserKey].balance += amount;
                                
                                // 📝 บันทึกยอดเทิร์นโอเวอร์สะสมเข้าไปในตัวแปรหลัก (ดักจับถ้าเป็นค่าว่างให้เป็น 0 ก่อนแล้วค่อยบวกทบ)
                                if (turnoverRequirement > 0) {
                                    let currentTurnover = usersWallets[foundUserKey].turnoverTarget;
                                    if (!currentTurnover || isNaN(currentTurnover)) {
                                        currentTurnover = 0;
                                    }
                                    usersWallets[foundUserKey].turnoverTarget = currentTurnover + turnoverRequirement;
                                }

                                const user = usersWallets[foundUserKey];
                                await saveDataToFirebase(); 
                                
                                // 📱 ประกอบข้อความแจ้งเตือนแอดมินและสมาชิก
                                replyText = `⚡ [ระบบจัดการเครดิตแอดมิน] \n👤 คุณ ${user.name} (สมาชิกที่ ${user.memberNumber})\n💰 ได้รับเครดิต: +${amount} บาท\n`;
                                if (turnoverRequirement > 0) {
                                    replyText += `⚠️ [ติดเงื่อนไข] ต้องทำยอดเทิร์นเพิ่ม: +${turnoverRequirement} บาท\n`;
                                    replyText += `📊 ยอดเทิร์นคงเหลือรวมที่ต้องทำ: ${user.turnoverTarget || 0} บาท\n`;
                                } else {
                                    replyText += `✅ รูปแบบ: เติมเงินสดปกติ (ไม่ติดเทิร์น)\n`;
                                }
                                replyText += `──────────────────\n💰 ยอดเงินปัจจุบัน: ${user.balance} บาท`;
                            }
                        }
                    }
                }
            }
// ==================== [ ระบบแจ้งฝากเงินสุ่มเศษสตางค์ ] ====================
               else if (userMsg.startsWith("ฝาก")) {
            // 🔍 ดึงตัวเลขด้วยวิธีเดียวกับระบบถอนของน้าเป๊ะๆ เลยครับ!
            const amount = parseInt(userMsg.replace('ฝาก', '').trim());
                   
                if (!amount || isNaN(amount) || amount <= 0) {
                    try {
                        await axios.post('https://api.line.me/v2/bot/message/reply', {
                            replyToken: replyToken,
                            messages: [
                                {
                                    "type": "flex",
                                    "altText": "⚠️ รูปแบบการฝากเงินไม่ถูกต้อง",
                                    "contents": {
                                        "type": "bubble",
                                        "styles": { "body": { "backgroundColor": "#0d1b15" } },
                                        "body": {
                                            "type": "box",
                                            "layout": "vertical",
                                            "spacing": "md",
                                            "contents": [
                                                { "type": "text", "text": "❌ พิมพ์รูปแบบผิดครับน้า!", "weight": "bold", "color": "#ff3333", "size": "md", "align": "center" },
                                                { "type": "separator", "color": "#183226" },
                                                { "type": "text", "text": "กรุณาพิมพ์ระบุจำนวนเงินที่ต้องการฝากด้วยค่ะ", "size": "xs", "color": "#cccccc", "align": "center" },
                                                {
                                                    "type": "box",
                                                    "layout": "vertical",
                                                    "backgroundColor": "#12261d",
                                                    "paddingAll": "sm",
                                                    "contents": [
                                                        { "type": "text", "text": "📌 รูปแบบ: ฝาก [จำนวนเงิน]", "size": "xs", "color": "#00ffcc", "weight": "bold", "align": "center" },
                                                        { "type": "text", "text": "👉 ตัวอย่าง: ฝาก 500", "size": "xs", "color": "#8abf9e", "align": "center" }
                                                    ]
                                                }
                                            ]
                                        }
                                    }
                                }
                            ]
                        }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` } });
                    } catch (err) { console.error("Error sending deposit invalid flex:", err); }
                    return res.sendStatus(200);
                } else {
                    const walletData = usersWallets[userId];

                    if (!walletData) {
                        try {
                            await axios.post('https://api.line.me/v2/bot/message/reply', {
                                replyToken: replyToken,
                                messages: [
                                    {
                                        "type": "flex",
                                        "altText": "⚠️ สมาชิกยังไม่ได้ลงทะเบียน",
                                        "contents": {
                                            "type": "bubble",
                                            "styles": { "body": { "backgroundColor": "#0d1b15" } },
                                            "body": {
                                                "type": "box",
                                                "layout": "vertical",
                                                "spacing": "md",
                                                "contents": [
                                                    { "type": "text", "text": "❌ ยังไม่ได้สมัครสมาชิก", "weight": "bold", "color": "#ff3333", "size": "md", "align": "center" },
                                                    { "type": "separator", "color": "#183226" },
                                                    { "type": "text", "text": "กรุณาลงทะเบียนเป็นสมาชิกกับเราก่อนเริ่มฝากเงินค่ะ", "size": "xs", "color": "#cccccc", "wrap": true, "align": "center" },
                                                    {
                                                        "type": "box",
                                                        "layout": "vertical",
                                                        "backgroundColor": "#12261d",
                                                        "paddingAll": "sm",
                                                        "contents": [
                                                            { "type": "text", "text": "พิมพ์: C/ชื่อ-นามสกุล,ธนาคาร,เลขบัญชี", "size": "xs", "color": "#00ffcc", "wrap": true },
                                                            { "type": "text", "text": "ตัวอย่าง: C/นายแจ๊ค เด้งดี,กสิกร,1234567890", "size": "xs", "color": "#8abf9e", "wrap": true }
                                                        ]
                                                    }
                                                ]
                                            }
                                        }
                                    }
                                ]
                            }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` } });
                        } catch (err) { console.error("Error sending deposit non-regist flex:", err); }
                        return res.sendStatus(200);
                    } else {
                        if (!global.depositQueue) global.depositQueue = {};

                        const currentQueue = global.depositQueue[userId];

                        if (currentQueue && currentQueue.status === 'WAITING_ADMIN') {
                            try {
                                await axios.post('https://api.line.me/v2/bot/message/reply', {
                                    replyToken: replyToken,
                                    messages: [
                                        {
                                            "type": "flex",
                                            "altText": "⚠️ มีรายการฝากค้างอยู่",
                                            "contents": {
                                                "type": "bubble",
                                                "styles": { "body": { "backgroundColor": "#0d1b15" } },
                                                "body": {
                                                    "type": "box",
                                                    "layout": "vertical",
                                                    "spacing": "md",
                                                    "contents": [
                                                        { "type": "text", "text": "⚠️ มีรายการแจ้งฝากค้างอยู่ในระบบ", "weight": "bold", "color": "#ffcc00", "size": "md", "align": "center" },
                                                        { "type": "separator", "color": "#183226" },
                                                        {
                                                            "type": "box",
                                                            "layout": "horizontal",
                                                            "contents": [
                                                                { "type": "text", "text": "💰 ยอดที่ต้องโอน:", "size": "sm", "color": "#8abf9e" },
                                                                { "type": "text", "text": `${currentQueue.displayAmount} บาท`, "size": "sm", "color": "#00ffcc", "weight": "bold", "align": "end" }
                                                            ]
                                                        },
                                                        { "type": "separator", "color": "#183226" },
                                                        { "type": "text", "text": "🔒 ระบบล็อกไม่ให้แจ้งฝากซ้ำ จนกว่าแอดมินจะอนุมัติรายการเดิมเรียบร้อยค่ะ", "size": "xs", "color": "#ffaa00", "wrap": true, "align": "center" }
                                                    ]
                                                }
                                            }
                                        }
                                    ]
                                }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` } });
                            } catch (err) { console.error("Error sending pending deposit alert flex:", err); }
                            return res.sendStatus(200);
                        } else {
                            global.satangCounter = (global.satangCounter % 99) + 1;
                            const satangValue = global.satangCounter / 100;
                            const totalWithSatang = amount + satangValue;
                            const displayAmount = totalWithSatang.toFixed(2);

// 🎯 1. ดึง Payload PromptPay จากเลข 15 หลัก K PLUS
const generatePayload = require('promptpay-qr');
const promptpayNumber = "004999031203416"; // 👈 เลข 15 หลัก K PLUS ของน้า
const payload = generatePayload(promptpayNumber, { amount: Number(displayAmount) });

// 🎯 2. สร้างลิงก์รูปภาพ QR Code ชัดๆ ผ่าน API ปลอดภัย
const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(payload)}`;

global.depositQueue[userId] = {
    memberId: walletData.memberNumber,
    name: walletData.name || 'ไม่ระบุชื่อ',
    rawAmount: amount,
    displayAmount: displayAmount,
    status: 'WAITING_ADMIN'
};

                            // ==================== [ 🚀 ใบแจ้งฝากสไตล์บิลธนาคาร + QR Code แบบย่อ ] ====================
try {
    // 🔍 ดึงชื่อเล่นจากข้อมูลสมาชิก (ถ้าไม่มีให้แสดงเป็นชื่อเต็ม หรือ fallback เป็น 'สมาชิก')
    const nickname = walletData.nickname || walletData.name || 'สมาชิก';
    const memberId = walletData.memberNumber || walletData.memberId || '-';
    await axios.post('https://api.line.me/v2/bot/message/reply', {
        replyToken: replyToken,
        messages: [
            {
                "type": "flex",
                "altText": `📥 ใบสั่งฝากเครดิต ยอดโอน: ${displayAmount} บาท`,
                "contents": {
                    "type": "bubble",
                    "styles": { "body": { "backgroundColor": "#09120e" } },
                    "body": {
                        "type": "box",
                        "layout": "vertical",
                        "spacing": "md",
                        "contents": [
                            { "type": "text", "text": "📥 ใบสั่งรายการฝากเงิน", "weight": "bold", "color": "#00ff88", "size": "md", "align": "center" },
                            {
                                "type": "box",
                                "layout": "horizontal",
                                "backgroundColor": "#0f1f17",
                                "paddingAll": "sm",
                                "contents": [
                                    { "type": "text", "text": `👤 คุณ: ${nickname}`, "size": "xs", "color": "#ffffff", "weight": "bold" },
                                    { "type": "text", "text": `ID: ${memberId}`, "size": "xs", "color": "#00ff88", "align": "end", "weight": "bold" }
                                ]
                            },
                            { "type": "separator", "color": "#12251c" },
                            {
                                "type": "box",
                                "layout": "vertical",
                                "spacing": "xs",
                                "contents": [
                                    { "type": "text", "text": "💸 กรุณาโอนเงินยอดสุทธิ:", "size": "xs", "color": "#8caf9c" },
                                    { "type": "text", "text": `${displayAmount} บาท`, "size": "xxl", "color": "#00ff88", "weight": "bold", "align": "center", "margin": "sm" },
                                    { "type": "text", "text": "(กรุณาโอนเศษสตางค์ให้ตรงเพื่ออัปยอดไวที่สุด)", "size": "10px", "color": "#ffaa00", "align": "center" }
                                ]
                            },
                            {
                                "type": "image",
                                "url": qrCodeUrl,
                                "size": "4xl",
                                "aspectRatio": "1:1",
                                "aspectMode": "fit",
                                "margin": "md"
                            },
                            { "type": "separator", "color": "#12251c" },
                            // เหลือไว้เฉพาะชื่อบัญชีตามที่ต้องการ
                            { 
                                "type": "text", 
                                "text": "👤 ชื่อบัญชี: นาย ภาณุวัฒก์ ก้องกุล", 
                                "size": "xs", 
                                "color": "#ffffff", 
                                "align": "center", 
                                "weight": "bold" 
                            },
                            { "type": "separator", "color": "#12251c" },
                            { "type": "text", "text": "⚠️ โอนตามยอดที่มีเศษสตางค์ แล้วส่งสลิปเพื่อยืนยันรายการได้เลยครับ", "size": "11px", "color": "#ff4444", "wrap": true, "align": "center", "weight": "bold" }
                        ]
                    }
                }
            }
        ]
    }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` } });
} catch (err) { 
    console.error("Error sending deposit bill flex:", err.response ? err.response.data : err.message); 
}
                    }
                }
            }
               }

                // ==================== [ คำสั่งแอดมิน: ชถ (เช็กรายการรอถอนเงินทั้งหมด) ] ====================
            else if (userMsg.trim() === 'ชถ') {
               // 🚨 เปลี่ยนตรงนี้: เช็กว่า ID คนพิมพ์อยู่ในกล่องแอดมินไหม
                if (!ADMIN_IDS.includes(userId)) {
                    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
                } else {
                    if (withdrawQueue.length === 0) {
                        replyText = "🎉 [ระบบคิวถอน] ไม่มีรายการค้างถอนในขณะนี้ครับ! สบายใจได้";
                    } else {
                        let queueText = "📋 [รายการรอถอนเงินทั้งหมด] 📋\n(เรียงตามลำดับก่อน-หลัง)\n────────────────\n";
                        
                        withdrawQueue.forEach((item, index) => {
                            queueText += `${index + 1}. 👤 สมาชิกคนที่: ${item.memberNumber}\n`;
                            queueText += `   📛 ชื่อ: คุณ ${item.name}\n`;
                            queueText += `   💰 ยอดถอน: ${item.amount} บาท\n`;
                            queueText += `   🕒 เวลา: ${item.time} น.\n────────────────\n`;
                        });
                        
                        queueText += `📌 รวมทั้งหมด: ${withdrawQueue.length} รายการค้างถอน\n💡 วิธีเคลียร์คิว: พิมพ์ "y เลขสมาชิก" (เช่น: y 1 หรือโอนพร้อมกันหลายคนพิมพ์: y 1 3 5)`;
                        replyText = queueText;
                    }
                }
            }    
           // ==================== [ 2. แอดมิน เปิด/ปิดรอบแทง - เวอร์ชันป้องกันมือลั่น ] ====================
else if (userMsg === 'o' || userMsg === 'x' || userMsg === 'rst') {
    if (!ADMIN_IDS.includes(userId)) {
        replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
    } else {
        // 🖼️ [ตั้งค่าลิงก์รูปภาพของน้าที่นี่] 
        // ⚠️ น้าเอาลิงก์ URL รูปภาพเปิด/ปิดรอบของน้า (ที่ขึ้นต้นด้วย https://) มาใส่แทนที่ในเครื่องหมายคำพูดได้เลยครับ
        const openRoundImgUrl = "https://img2.pic.in.th/-__-----4b1c38e0628ea626.jpg"; 
        const closeRoundImgUrl = "https://img2.pic.in.th/-__-----2cccaadd8f93c70b.jpg";

        if (userMsg === 'o') {
            if (isRoundOpen) {
                replyText = `⚠️ ตอนนี้ระบบกำลังเปิด "รอบที่ ${currentRound}" อยู่แล้วครับ`;
            } 
            else if (isDrawOpen) { 
                replyText = `❌ ไม่สามารถเปิดรอบใหม่ได้ครับ!\nเนื่องจาก "รอบที่ ${currentRound}" ยังดำเนินรายการจั่วไพ่ไม่เสร็จสิ้น\n\n💡 หากต้องการเปิดรอบจั่ว ให้พิมพ์ oo\n💡 หากต้องการจบขั้นตอนจั่ว ให้พิมพ์ xx ก่อนครับ`;
            } else {
                currentRound++;
                isRoundOpen = true;
                roundBets = {}; // ล้างข้อมูลโพยเก่าออกเพื่อเริ่มรอบใหม่
                await saveDataToFirebase();
                
                // --- 📊 สร้างโครงสร้างสถิติย้อนหลัง ---
                let historyFlexContents = [];
                if (matchHistory && matchHistory.length > 0) {
                    // วนลูปแปลงค่าให้ปลอดภัย ไม่ว่าประวัติจะเป็น Object หรือ String
                    historyFlexContents = matchHistory.map(item => {
                        let textDisplay = typeof item === 'object' ? JSON.stringify(item) : item;
                        return {
                            "type": "text",
                            "text": textDisplay,
                            "size": "xs",
                            "color": "#E2E1E4",
                            "wrap": true
                        };
                    });
                } else {
                    historyFlexContents.push({
                        "type": "text",
                        "text": "• ยังไม่มีข้อมูลสถิติย้อนหลังในรอบนี้",
                        "size": "xs",
                        "color": "#E2E1E4",
                        "style": "italic",
                        "align": "center"
                    });
                }

                // 🚀 ยิงข้อความแพ็คคู่: [1. รูปภาพเปิดรอบ] + [2. Flex Message สถิติ]
                try {
                    await axios.post('https://api.line.me/v2/bot/message/reply', {
                        replyToken: replyToken,
                        messages: [
                            // 📸 ข้อความที่ 1: รูปเปิดรอบของน้า
                            {
                                "type": "image",
                                "originalContentUrl": openRoundImgUrl,
                                "previewImageUrl": openRoundImgUrl
                            },
                            // 📊 ข้อความที่ 2: Flex Message สรุปและสถิติ
                            {
                                "type": "flex",
                                "altText": `🟢 เริ่มเปิดรอบแทงแล้ว! รอบที่ ${currentRound}`,
                                "contents": {
                                    "type": "bubble",
                                    "styles": { "body": { "backgroundColor": "#1A1A1A" } },
                                    "body": {
                                        "type": "box", "layout": "vertical", "spacing": "md",
                                        "contents": [
                                            { "type": "text", "text": "🎰 เริ่มเปิดรอบแทงแล้วครับ 🎉", "weight": "bold", "color": "#66FF00", "size": "md", "align": "center" },
                                            { "type": "text", "text": `รอบที่: ${currentRound}`, "weight": "bold", "color": "#ffffff", "size": "xl", "align": "center", "margin": "none" },
                                            { "type": "separator", "color": "#22031F" },
                                            { "type": "text", "text": "📈 สถิติผลเจ้ามือ 5 รอบล่าสุด", "size": "xs", "color": "#66FF00", "weight": "bold" },
                                            // 🔥 นำกล่องแถวประวัติวงรีมาวางตรงนี้โดยตรง
                                            { 
                                                "type": "box", 
                                                "layout": "vertical", 
                                                "spacing": "xs", 
                                                "contents": historyFlexContents 
                                            },
                                            { "type": "separator", "color": "#1f3a2b" },
                                            { "type": "text", "text": "✨ สมาชิกสามารถส่งโพยเข้ามาได้เลยครับ 🎰", "size": "sm", "color": "#ffffff", "wrap": true, "align": "center", "weight": "bold" }
                                        ]
                                    }
                                }
                            }
                        ]
                    }, {
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${TOKEN}`
                        }
                    });
                } catch (error) {
                    console.error("❌ ส่งรูปภาพและ Flex เปิดรอบล้มเหลว:", error.response ? error.response.data : error.message);
                }
                return; 
            }
        } else if (userMsg === 'x') {
            if (!isRoundOpen) {
                replyText = `⚠️ ระบบปิดรอบแทงอยู่แล้วครับ ไม่สามารถปิดซ้ำได้`;
            } else {
                isRoundOpen = false;
                await saveDataToFirebase();
                
                // --- 📊 [สรุปยอดแทงรายบุคคลเพื่อใส่ใน Flex] ---
                let summaryFlexContents = [];
                let hasAnyBet = false;

                // 💡 ฟังก์ชันช่วยแปลง betType ให้กลายเป็นข้อความอ่านง่าย
                const formatLegDisplay = (bet) => {
                    if (!bet || !bet.betType) return "ไม่ระบุขา";
                    const type = bet.betType;
                    const price = bet.pricePerLeg || 0;

                    if (type === "รข") return `เหมาขวา (${price}/ขา)`;
                    if (type === "รจ") return `เหมาเจ้า (${price}/ขา)`;
                    if (type.startsWith('จ')) {
                        const legs = type.substring(1).split('').join(', ');
                        return `แทงเจ้าสู้ขา ${legs} (${price}/ขา)`;
                    }
                    // กรณีแทงขาผู้เล่นปกติ เช่น "12" -> "ขา 1, 2 (20/ขา)"
                    const legs = type.split('').join(', ');
                    return `ขา ${legs} (${price}/ขา)`;
                };

                for (let uId in roundBets) {
                    const userBetsArray = roundBets[uId];
                    if (!userBetsArray || userBetsArray.length === 0) continue;

                    hasAnyBet = true;
                    const user = usersWallets[uId] || {};
                    
                    const displayName = user.nickname || user.name || "สมาชิก";
                    
                    let userTotalBetAmt = 0;
                    let legsList = [];

                    userBetsArray.forEach((b) => {
                        // สะสมยอดค้ำ/ยอดแทงจริง
                        if (b.actualBet) {
                            userTotalBetAmt += b.actualBet;
                        }

                        // 🛠️ แก้ไขจุดนี้: ดึงขาที่แทงจาก b.betType ผ่านฟังก์ชันจัดรูปแบบ
                        const legDisplay = formatLegDisplay(b);
                        legsList.push(legDisplay);
                    });

                    // รวมขาที่แทงเข้าด้วยกัน เช่น "ขา1 (20), ขา2 (20)"
                    const legTextDisplay = legsList.length > 0 ? legsList.join(', ') : 'ไม่มีข้อมูลขา';

                   // 3. สร้าง UI Box แสดงผล (บรรทัดแรก: เลขสมาชิก + ชื่อเล่น + ยอดรวม, บรรทัดสอง: ขาที่ลง)
                    summaryFlexContents.push({
                        "type": "box",
                        "layout": "vertical",
                        "margin": "md",
                        "contents": [
                            {
                                "type": "box",
                                "layout": "horizontal",
                                "contents": [
                                    { 
                                        "type": "text", 
                                        "text": `• [ ${user.memberNumber || '-'} ] ${displayName}`, 
                                        "size": "sm", 
                                        "color": "#ffffff", 
                                        "weight": "bold",
                                        "flex": 5, 
                                        "wrap": true 
                                    },
                                    { 
                                        "type": "text", 
                                        "text": `${userTotalBetAmt} ฿`, 
                                        "size": "sm", 
                                        "color": "#ffaa00", 
                                        "align": "end", 
                                        "weight": "bold", 
                                        "flex": 3 
                                    }
                                ]
                            },
                            {
                                "type": "text",
                                "text": `   🎯 ขาที่ลง: ${legTextDisplay}`,
                                "size": "xs",
                                "color": "#aaaaaa",
                                "wrap": true,
                                "margin": "xs"
                            }
                        ]
                    });
                }

                if (!hasAnyBet) {
                    summaryFlexContents.push({
                        "type": "text",
                        "text": "• ไม่มีสมาชิกส่งโพยเดิมพันในรอบนี้",
                        "size": "sm",
                        "color": "#888888",
                        "style": "italic",
                        "align": "center"
                    });
                }

                // 🚀 ยิงข้อความแพ็คคู่: [1. รูปภาพปิดรอบ] + [2. Flex Message สไลด์ carousel รายชื่อ]
                try {
                    // 1. ฟังก์ชันช่วยเหลือสำหรับตัดแบ่ง array ออกเป็นหน้าๆ (Chunking)
                    const chunkSize = 5; // ปรับเหลือ 4 รายชื่อต่อหน้า เพื่อรองรับบรรทัดแสดงขาแทงไม่ให้ล้นการ์ด
                    const flexPages = [];
                    for (let i = 0; i < summaryFlexContents.length; i += chunkSize) {
                        flexPages.push(summaryFlexContents.slice(i, i + chunkSize));
                    }

                    // 2. ถ้าไม่มีคนแทงเลย ให้สร้างการ์ดเปล่าป้องกันโค้ดรวน
                    if (flexPages.length === 0) {
                        flexPages.push([{ "type": "text", "text": "ไม่มีรายการแทงในรอบนี้", "color": "#aaaaaa", "size": "xs", "align": "center" }]);
                    }

                    // 3. วนลูปสร้างการ์ด Bubble แต่ละหน้าสำหรับ Carousel
                    const carouselBubbles = flexPages.map((pageContents, index) => ({
                        "type": "bubble",
                        "styles": { "body": { "backgroundColor": "#1A1A1A" } },
                        "body": {
                            "type": "box", "layout": "vertical", "spacing": "md",
                            "contents": [
                                { "type": "text", "text": "🚫 ปิดรอบแทงเรียบร้อยแล้วครับ 🏁", "weight": "bold", "color": "#E9100F", "size": "md", "align": "center" },
                                { "type": "text", "text": `จบรอบที่: ${currentRound} (หน้า ${index + 1}/${flexPages.length})`, "weight": "bold", "color": "#ffffff", "size": "sm", "align": "center" },
                                { "type": "separator", "color": "#3a2222" },
                                { "type": "text", "text": "📝 สรุปยอดแทงประจำรอบ", "size": "xs", "color": "#FFCE00", "weight": "bold" },
                                { "type": "box", "layout": "vertical", "spacing": "xs", "contents": pageContents },
                                { "type": "separator", "color": "#3a2222" },
                                { "type": "text", "text": "🔒 หยุดรับโพยทุกกรณี รอแอดมินเปิดรอบจั่ว", "size": "sm", "color": "#E9100F", "wrap": true, "align": "center", "weight": "bold" }
                            ]
                        }
                    }));

                    // 4. ส่ง API ไปยัง LINE
                    await axios.post('https://api.line.me/v2/bot/message/reply', {
                        replyToken: replyToken,
                        messages: [
                            {
                                "type": "image",
                                "originalContentUrl": closeRoundImgUrl,
                                "previewImageUrl": closeRoundImgUrl
                            },
                            {
                                "type": "flex",
                                "altText": `🚫 ปิดรอบแทงเรียบร้อย รอบที่ ${currentRound}`,
                                "contents": {
                                    "type": "carousel",
                                    "contents": carouselBubbles
                                }
                            }
                        ]
                    }, {
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${TOKEN}`
                        }
                    });
                } catch (error) {
                    console.error("❌ ส่งรูปภาพและ Flex ปิดรอบล้มเหลว:", error.response ? error.response.data : error.message);
                }
                return;
            }
        } else if (userMsg === 'rst') {
            currentRound = 0;
            isRoundOpen = false;
            isDrawOpen = false; // ล้างสถานะจั่วไปด้วยเลยตอนเซ็ตศูนย์
            roundBets = {};
            usersRoundCrossCheck = {};
            matchHistory = []; // รีเซ็ตประวัติ 5 รอบย้อนหลังออกไปด้วย
            pastRoundsData = {};

            await saveDataToFirebase(); //💾เซฟถาวร
            
            replyText = "🔄 ทำการล้างลำดับรอบเรียบร้อยแล้ว! รอบต่อไปจะเริ่มต้นที่ รอบที่ 1 ครับ ⚙️";
        }
    }
}
            // ==================== [ 3. แอดมิน เปิด/ปิดรอบจั่วไพ่ - เวอร์ชันบล็อกพิมพ์ซ้ำ ] ====================
else if (userMsg === 'oo' || userMsg === 'xx') {
    if (!ADMIN_IDS.includes(userId)) {
        replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
    } else {
        // 🖼️ [ตั้งค่าลิงก์รูปภาพของน้าที่นี่]
        // ⚠️ น้าเอาลิงก์ URL รูปภาพเปิดจั่ว/ปิดจั่วของน้า (ที่ขึ้นต้นด้วย https://) มาใส่แทนที่ได้เลยครับ
        const openDrawImgUrl = "https://img2.pic.in.th/-__-----7fcbb7b1eadadfe1.jpg";
        const closeDrawImgUrl = "https://img2.pic.in.th/-__-----17ded3ef1c297156";

        // 🟢 [ฝั่งเปิดรอบจั่ว oo]
        if (userMsg === 'oo') {
            if (isRoundOpen) {
                replyText = "⚠️ ต้องพิมพ์ปิดรอบแทง (X) ก่อน จึงจะเปิดรอบจั่วได้ครับ";
            } else if (isDrawOpen) {
                replyText = `⚠️ ตอนนี้ระบบกำลังเปิด "รอบขอจั่วไพ่ใบที่ 3" อยู่แล้วครับ ไม่จำเป็นต้องเปิดซ้ำครับ`;
            } else {
                isDrawOpen = true; // เปิดสิทธิ์ให้บอทรับคำสั่งเครื่องหมาย + จากสมาชิก

                // 🚀 ยิงข้อความแพ็คคู่: [1. รูปภาพเปิดจั่วของน้า] + [2. Flex Message เปิดจั่วอย่างเป็นทางการ]
                try {
                    await axios.post('https://api.line.me/v2/bot/message/reply', {
                        replyToken: replyToken,
                        messages: [
                            // 📸 ข้อความที่ 1: รูปเปิดจั่วของน้า
                            {
                                "type": "image",
                                "originalContentUrl": openDrawImgUrl,
                                "previewImageUrl": openDrawImgUrl
                            },
                            // 📊 ข้อความที่ 2: Flex Message เปิดจั่ว
                            {
                                "type": "flex",
                                "altText": `🃏 เปิดรอบขอจั่วไพ่ใบที่ 3 (รอบที่ ${currentRound})`,
                                "contents": {
                                    "type": "bubble",
                                    "styles": { "body": { "backgroundColor": "#0b1528" } }, // ธีมน้ำเงินเข้มคาสิโน
                                    "body": {
                                        "type": "box", "layout": "vertical", "spacing": "md",
                                        "contents": [
                                            { "type": "text", "text": "🃏 เปิดรอบขอจั่วไพ่ใบที่ 3 แล้วครับ 🎉", "weight": "bold", "color": "#3399ff", "size": "md", "align": "center" },
                                            { "type": "text", "text": `รอบที่: ${currentRound}`, "weight": "bold", "color": "#ffffff", "size": "lg", "align": "center", "margin": "none" },
                                            { "type": "separator", "color": "#1b2a47" },
                                            { "type": "text", "text": "💡 สำหรับสมาชิกที่ต้องการจั่วไพ่เพิ่ม\nให้พิมพ์เลขขาตามด้วยเครื่องหมายบวก (+)\nเช่น พิมพ์ \"1+\" หรือ \"12+\"", "size": "sm", "color": "#dddddd", "wrap": true, "align": "center" },
                                            { "type": "separator", "color": "#1b2a47" },
                                            { "type": "text", "text": "⚠️ หากขาไหนต้องการอยู่ (ไม่จั่ว) ไม่ต้องพิมพ์อะไรส่งมาครับ", "size": "xs", "color": "#ffcc00", "wrap": true, "align": "center" }
                                        ]
                                    }
                                }
                            }
                        ]
                    }, {
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${TOKEN}`
                        }
                    });
                } catch (error) {
                    console.error("❌ ส่งรูปภาพและ Flex เปิดจั่วล้มเหลว:", error.response ? error.response.data : error.message);
                }
                return; // จบกระบวนการเปิดจั่วอย่างสมบูรณ์ บอทไม่ทำงานซ้ำซ้อน
            }
        } 
        // 🔴 [ฝั่งปิดรอบจั่ว xx + สรุปรายละเอียดรายบุคคล]
        else if (userMsg === 'xx') {
            if (!isDrawOpen) {
                replyText = "⚠️ ระบบปิดรอบจั่วไพ่อยู่แล้วครับ ไม่สามารถปิดซ้ำได้";
            } else {
                // 1. ปิดระบบรับรอบจั่วทันที
                isDrawOpen = false;

                // 2. ดำเนินการวนลูปดึงข้อมูลจากโค้ดหลักของน้าแบบไม่มีตกหล่น
                let summaryFlexContents = [];
                let hasBets = false;

                // วนลูปเช็กข้อมูลโพยของทุกคนในรอบนี้ (ตามตรรกะเดิมเป๊ะๆ)
                for (let uid in roundBets) {
                    const userBetsArray = roundBets[uid];
                    if (userBetsArray && userBetsArray.length > 0) {
                        hasBets = true;
                        const user = usersWallets[uid] || {}; // ดึงข้อมูลโปรไฟล์สมาชิก

                        // 💡 ดึงชื่อเล่น (ถ้าน้าไม่ได้ตั้ง nickname ไว้ ระบบจะถอยไปใช้ user.name อัตโนมัติ)
                        const displayName = user.nickname || user.name || "สมาชิก";

                        let totalRealPlay = 0; // ยอดเล่นรวมจริง
                        let totalWithBounce = 0; // ยอดค้ำประกัน (รวมค้ำเด้ง 3 เท่า)
                        let betLegsDetail = []; // เก็บรายละเอียดเบอร์ขาที่แทง
                        let drawLegsDetail = []; // เก็บรายละเอียดขาที่ขอจั่วเพิ่ม

                        userBetsArray.forEach((bet) => {
                            // คำนวณเบอร์ขาฝั่งผู้เล่นปกติ
                            if (bet.betType !== "รข" && bet.betType !== "รจ" && !bet.betType.startsWith('จ')) {
                                const individualLegs = bet.betType.split('');
                                individualLegs.forEach((leg) => {
                                    if (!betLegsDetail.includes(leg)) betLegsDetail.push(leg);
                                    
                                    // เช็กสถานะการจั่วใบที่ 3 ของขานี้
                                    if (bet.drawStatus && bet.drawStatus[leg] === "จั่ว") {
                                        if (!drawLegsDetail.includes(leg)) drawLegsDetail.push(leg);
                                    }
                                });
                            } 
                            // สำหรับกรณีแทงพิเศษอื่นๆ (รข / รจ / ขาเจ้ามือ)
                            else {
                                if (!betLegsDetail.includes(bet.betType)) {
                                    betLegsDetail.push(bet.betType);
                                }
                            }

                            // คำนวณยอดเงินรวม
                            totalRealPlay += bet.totalPrice || bet.actualBet; // รองรับโครงสร้างชื่อตัวแปรของโพย
                            totalWithBounce += bet.holdCost; // ดึงยอดค้ำเด้ง 3 เท่าที่ระบบหักไว้จริงมาแสดง
                        });

                        // จัดเรียงรายชื่อขาให้สวยงามเพื่ออ่านง่าย
                        const legsStr = betLegsDetail.sort().join(', ');
                        const drawStr = drawLegsDetail.length > 0 ? drawLegsDetail.sort().join(', ') : "ไม่มี (อยู่ 2 ใบ)";

                        // นำข้อมูลที่ประมวลผลได้มาแพ็คใส่รูปแบบ Flex Layout เพื่อความสวยงามและแสดงผลเป็นระเบียบ
                        summaryFlexContents.push({
                            "type": "box", "layout": "vertical", "margin": "md", "spacing": "xs",
                            "contents": [
                                { "type": "text", "text": `👤 [ ${user.memberNumber || '-'} ] ${displayName}`, "weight": "bold", "color": "#ffffff", "size": "sm" },
                                {
                                    "type": "box", "layout": "horizontal",
                                    "contents": [
                                        { "type": "text", "text": `👉 แทงขา: [ ${legsStr} ]`, "size": "xs", "color": "#cccccc", "flex": 5 },
                                        { "type": "text", "text": `🃏 จั่วเพิ่ม: [ ${drawStr} ]`, "size": "xs", "color": "#3399ff", "flex": 5, "weight": "bold", "align": "end" }
                                    ]
                                },
                                {
                                    "type": "box", "layout": "horizontal",
                                    "contents": [
                                        { "type": "text", "text": `💰 ยอดเล่น: ${totalRealPlay} ฿`, "size": "xs", "color": "#aaaaaa", "flex": 5 },
                                        { "type": "text", "text": `(รวมค้ำ: ${totalWithBounce} ฿)`, "size": "xs", "color": "#00ff66", "flex": 5, "align": "end", "weight": "bold" }
                                    ]
                                },
                                { "type": "separator", "color": "#2c2214", "margin": "xs" }
                            ]
                        });
                    }
                }

                if (!hasBets) {
                    summaryFlexContents.push({
                        "type": "text",
                        "text": "• รอบนี้ไม่มีสมาชิกส่งโพยเดิมพันเข้ามาครับ",
                        "size": "sm",
                        "color": "#888888",
                        "style": "italic",
                        "align": "center"
                    });
                }

                // 🚀 ยิงข้อความแพ็คคู่: [1. รูปภาพปิดจั่วของน้า] + [2. Flex Message สรุปโพยและการจั่วรายบุคคล]
                try {
                    // 1. แบ่งกลุ่มการแสดงผล (Chunking) หน้าละ 3 รายชื่อ เพื่อไม่ให้ตัว Flex สรุปจั่วยาวจนเกินไป
                    const chunkSize = 7; 
                    const flexPages = [];
                    for (let i = 0; i < summaryFlexContents.length; i += chunkSize) {
                        flexPages.push(summaryFlexContents.slice(i, i + chunkSize));
                    }

                    // 2. ป้องกันข้อผิดพลาดกรณีไม่มีการส่งโพย
                    if (flexPages.length === 0) {
                        flexPages.push([{ "type": "text", "text": "ไม่มีรายการแทงในรอบนี้", "color": "#aaaaaa", "size": "xs", "align": "center" }]);
                    }

                    // 3. วนลูปสร้างหน้าการ์ด (Bubble Carousel)
                    const carouselBubbles = flexPages.map((pageContents, index) => ({
                        "type": "bubble",
                        "styles": { "body": { "backgroundColor": "#1a140d" } },
                        "body": {
                            "type": "box", "layout": "vertical", "spacing": "sm",
                            "contents": [
                                { "type": "text", "text": "🔒 ปิดรอบขอจั่วไพ่เรียบร้อยแล้วครับ 🏁", "weight": "bold", "color": "#ffaa00", "size": "md", "align": "center" },
                                { "type": "text", "text": `รอบที่: ${currentRound} (หน้า ${index + 1}/${flexPages.length})`, "size": "xs", "color": "#ffffff", "align": "center" },
                                { "type": "separator", "color": "#3a2d1f" },
                                { "type": "text", "text": "📋 รายงานสรุปโพยและการจั่วรายบุคคล", "size": "xs", "color": "#ffaa00", "weight": "bold" },
                                { "type": "box", "layout": "vertical", "spacing": "xs", "contents": pageContents },
                                { "type": "text", "text": "ℹ️ รอสรุปผลและคิดเงินสักครู่ครับ", "size": "xs", "color": "#aaaaaa", "align": "center", "margin": "sm" }
                            ]
                        }
                    }));

                    // 4. ยิง API ตอบกลับ
                    await axios.post('https://api.line.me/v2/bot/message/reply', {
                        replyToken: replyToken,
                        messages: [
                            {
                                "type": "image",
                                "originalContentUrl": closeDrawImgUrl,
                                "previewImageUrl": closeDrawImgUrl
                            },
                            {
                                "type": "flex",
                                "altText": `🚫 ปิดรอบขอจั่วไพ่เรียบร้อยแล้ว (รอบที่ ${currentRound})`,
                                "contents": {
                                    "type": "carousel", // 👈 เปลี่ยนโครงสร้างเป็น carousel แบบสไลด์ข้าง
                                    "contents": carouselBubbles
                                }
                            }
                        ]
                    }, {
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${TOKEN}`
                        }
                    });
                } catch (error) {
                    console.error("❌ ส่งรูปภาพและ Flex ปิดจั่วล้มเหลว:", error.response ? error.response.data : error.message);
                }
                return;
            }
        }
    }
}
        // ==================== [ 4. ระบบรับโพยป๊อกเด้ง + หักค้ำประกัน 3 เด้ง ] ====================
            else if (originalMsg.includes('-') && !originalMsg.startsWith('C/') && !originalMsg.startsWith('c/')) {
                if (!isRoundOpen) {
                    replyText = "🚫 ตอนนี้ระบบปิดรับโพยชั่วคราวครับ กรุณารอแอดมินเปิดรอบใหม่";
                } else {
                    const isRegistered = usersWallets[userId] ? true : false;
                    if (!isRegistered) {
                        replyText = `📢 ยินดีต้อนรับครับสมาชิกใหม่!\n\n⚠️ คุณยังไม่ได้ลงทะเบียนชื่อจริงในระบบ\nกรุณาพิมพ์: C/ชื่อ-นามสกุล ของท่านเพื่อสมัครสมาชิกก่อนแทงครับ`;
                    } else {
                        const user = usersWallets[userId];

                        // 💡 สร้างตัวแปรชื่อเล่นสำหรับแสดงผล (ถ้าไม่มี nickname ให้ถอยไปใช้ name)
                        const displayName = user.nickname || user.name || "ไม่ระบุชื่อ";

                        // 🔒 [แก้ไขจุดบกพร่อง] ดักจับสถานะล็อกถอนเงิน และสั่งให้บอทยิงข้อความเตือนทันที!
                        if (user && user.isWithdrawLocked) {
                            const lockMsg = `❌ คุณไม่สามารถส่งโพยแทงได้ครับ!\n👤 คุณ ${displayName} (ID: ${user.memberNumber}) อยู่ในระหว่าง "รอแอดมินโอนเงินและอนุมัติยอดถอน" (${user.pendingWithdrawAmount} บาท) บัญชีของคุณจึงถูกล็อกชั่วคราวครับ`;
                            
                            try {
                                await axios.post('https://api.line.me/v2/bot/message/reply', {
                                    replyToken: replyToken,
                                    messages: [{ type: 'text', text: lockMsg }]
                                }, {
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Authorization': `Bearer ${TOKEN}`
                                    }
                                });
                            } catch (error) {
                                console.error("❌ ส่งข้อความแจ้งเตือนล็อกถอนล้มเหลว:", error.response ? error.response.data : error.message);
                            }
                            return; 
                        }
                        const lines = originalMsg.split(/\r?\n/);
                        
                        let totalActualBet = 0; 
                        let totalHoldCost = 0;
                        let processedBets = [];
                        let hasError = false;
                        let errorMsg = "";

                        // 🔄 [แก้ไขบั๊ก จ โดนบล็อก] ตรวจสอบรอบแทง ถ้าผู้เล่นยังไม่มีโพยในรอบนี้เลย ให้ล้างค่าดักแทงสวนของเก่าทิ้งก่อน
                        if (!roundBets[userId] || roundBets[userId].length === 0) {
                            usersRoundCrossCheck[userId] = {}; // ล้างความจำขยะรอบเก่าทันที
                        }

                        if (!usersRoundCrossCheck[userId]) {
                            usersRoundCrossCheck[userId] = {};
                        }
                        let betTracker = usersRoundCrossCheck[userId];

                        const allowedLegs = ['1', '2', '3', '4', '5', '6'];
                        const MIN_BET = 10;
                        const MAX_BET = 2500;

                        for (let line of lines) {
                            let cleanLine = line.trim().toLowerCase();
                            if (cleanLine === "") continue;

                            const parts = cleanLine.split('-');
                            if (parts.length !== 2) {
                                hasError = true;
                                errorMsg = `⚠️ รูปแบบโพยไม่ถูกต้องในบรรทัด: "${line}"\n(ตัวอย่าง: 1-100 หรือ 123-100)`;
                                break;
                            }

                            const targetStr = parts[0].trim();
                            const price = parseFloat(parts[1].trim());

                            if (isNaN(price) || price <= 0) {
                                hasError = true;
                                errorMsg = `⚠️ จำนวนเงินไม่ถูกต้องในบรรทัด: "${line}"`;
                                break;
                            }

                            if (price < MIN_BET || price > MAX_BET) {
                                hasError = true;
                                errorMsg = `❌ แทงไม่สำเร็จ! ยอดแทงต่อขาต้องอยู่ระหว่าง ${MIN_BET} ถึง ${MAX_BET} บาทครับ\n(คุณพิมพ์มา ขาละ ${price} บาท ในบรรทัด: "${line}")`;
                                break;
                            }

                            let legsCount = 0;
                            let betTypeDetail = "";

                            if (targetStr === "รข") {
                                legsCount = 6;
                                betTypeDetail = `เหมาขาผู้เล่นสู้เจ้ามือ (6 ขา) ขาละ ${price} บาท`;
                                for (let c = 1; c <= 6; c++) {
                                    if (betTracker[c] && betTracker[c] === 'dealer') {
                                        hasError = true;
                                        errorMsg = `❌ แทง รข ไม่ได้! ขา ${c} มีการแทงฝั่งเจ้ามือค้างไว้แล้วในรอบนี้`;
                                        break;
                                    }
                                }
                                if (hasError) break; 
                                for (let c = 1; c <= 6; c++) { betTracker[c] = 'player'; }
                                
                            } else if (targetStr === "รจ") {
                                legsCount = 6;
                                betTypeDetail = `แทงเจ้ามือสู้ทุกขา (4 ขา) ขาละ ${price} บาท`;
                                for (let c = 1; c <= 6; c++) {
                                    if (betTracker[c] && betTracker[c] === 'player') {
                                        hasError = true;
                                        errorMsg = `❌ แทง รจ ไม่ได้! ขา ${c} มีการแทงฝั่งผู้เล่นค้างไว้แล้วในรอบนี้`;
                                        break;
                                    }
                                }
                                if (hasError) break; 
                                for (let c = 1; c <= 6; c++) { betTracker[c] = 'dealer'; }
                            } else if (targetStr.startsWith('จ')) {
                                const legs = targetStr.substring(1);
                                if (legs === "") { 
                                    hasError = true; 
                                    errorMsg = `⚠️ ไม่ระบุเลขขาเจ้ามือในบรรทัด: "${line}"`; 
                                    break;
                                }

                                let isLegsValid = legs.split('').every(char => allowedLegs.includes(char));
                                if (!isLegsValid) {
                                    hasError = true;
                                    errorMsg = `❌ บันทึกโพยล้มเหลว! ห้องนี้มีแค่ ขา 1 ถึง ขา 6 เท่านั้นครับ\n(พบข้อผิดพลาดที่ขาเจ้ามือ: "${line}")`;
                                    break;
                                }
                                
                                legsCount = legs.length;
                                betTypeDetail = `เจ้ามือสู้ขา [${legs.split('').join(', ')}] ขาละ ${price} บาท`;
                                const targetLegs = legs.split('');
                                for (let c of targetLegs) {
                                    if (betTracker[c] && betTracker[c] === 'player') {
                                        hasError = true;
                                        errorMsg = `❌ แทงสวนไม่ได้! ขา ${c} มีการแทงฝั่งผู้เล่นไปแล้วในรอบนี้`;
                                        break;
                                    }
                                }
                                if (hasError) break;

                                for (let c of targetLegs) { betTracker[c] = 'dealer'; }
                            } else {
                                let isLegsValid = targetStr.split('').every(char => allowedLegs.includes(char));
                                if (!isLegsValid) {
                                    hasError = true;
                                    errorMsg = `❌ บันทึกโพยล้มเหลว! ห้องนี้มีแค่ ขา 1 ถึง ขา 6 เท่านั้นครับ\n(พบข้อผิดพลาดที่ขาผู้เล่น: "${line}")`;
                                    break;
                                }
                                legsCount = targetStr.length;
                                betTypeDetail = `แทงขา [${targetStr.split('').join(', ')}] ขาละ ${price} บาท`;
                                const targetLegs = targetStr.split('');
                                for (let c of targetLegs) {
                                    if (betTracker[c] && betTracker[c] === 'dealer') {
                                        hasError = true;
                                        errorMsg = `❌ แทงสวนไม่ได้! ขา ${c} มีการแทงฝั่งเจ้ามือไปแล้วในรอบนี้`;
                                        break;
                                    }
                                }
                                if (hasError) break;

                                for (let c of targetLegs) { betTracker[c] = 'player'; }
                            }

                            let currentLineBet = price * legsCount;
                            let currentLineHold = currentLineBet * 3;

                            totalActualBet += currentLineBet;
                            totalHoldCost += currentLineHold;

                            processedBets.push({
                                type: targetStr,
                                detail: betTypeDetail,
                                actualBet: currentLineBet,
                                holdCost: currentLineHold,
                                pricePerLeg: price
                            });
                        }

                        // ==================== [ 🌟 เริ่มต้นระบบค้ำประกันเด้งอัจฉริยะ ] ====================
                        if (!hasError && totalActualBet > 0) {
                            let finalHoldCost = 0;
                            let maxHandMultiplier = 3; 
                            let limitReasonText = "✨ ค้ำประกัน 3 เด้งสมบูรณ์แบบ";

                            const doubleHoldCost = totalActualBet * 2; 
                            const tripleHoldCost = totalActualBet * 3; 

                            if (user.balance < doubleHoldCost) {
                                replyText = `❌ เครดิตของคุณไม่พอสำหรับค้ำประกันขั้นต่ำ (2 เด้ง) ครับ!\n💸 ยอดแทงรวม: ${totalActualBet} บาท\n🔒 ต้องใช้ยอดค้ำประกันขั้นต่ำ (x2): ${doubleHoldCost} บาท\n💰 เครดิตปัจจุบันของคุณมี: ${user.balance} บาท`;
                                hasError = true;
                            } 
                            else if (user.balance >= doubleHoldCost && user.balance < tripleHoldCost) {
                                maxHandMultiplier = 2;
                                finalHoldCost = doubleHoldCost;
                                limitReasonText = `⚠️ คิดผลสูงสุดไม่เกิน 2 เด้ง (เครดิตไม่พอค้ำ 3 เด้ง)`;
                            } 
                            else {
                                maxHandMultiplier = 3;
                                finalHoldCost = tripleHoldCost;
                            }

                            if (!hasError) {
                                user.balance -= finalHoldCost; 
                                await saveDataToFirebase();
                                
                                if (!roundBets[userId]) {
                                    roundBets[userId] = [];
                                }

                                let itemsFlexContents = [];
                                
                                processedBets.forEach((bet) => {
                                    roundBets[userId].push({
                                        name: displayName,
                                        memberNumber: user.memberNumber,
                                        betType: bet.type,
                                        detail: bet.detail,
                                        pricePerLeg: bet.pricePerLeg,
                                        actualBet: bet.actualBet,
                                        holdCost: (bet.actualBet * maxHandMultiplier), 
                                        maxMultiplier: maxHandMultiplier, 
                                        time: new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' })
                                    });

                                    itemsFlexContents.push({
                                        "type": "text",
                                        "text": `• ${bet.detail}`,
                                        "size": "sm",
                                        "color": "#dddddd",
                                        "wrap": true
                                    });
                                });
                                
                                try {
                                    await axios.post('https://api.line.me/v2/bot/message/reply', {
                                        replyToken: replyToken,
                                        messages: [{
                                            "type": "flex",
                                            "altText": "🧾 บันทึกโพยสำเร็จเรียบร้อยแล้ว",
                                            "contents": {
                                                "type": "bubble",
                                                "styles": { "body": { "backgroundColor": "#111111" } },
                                                "body": {
                                                    "type": "box", "layout": "vertical", "spacing": "md",
                                                    "contents": [
                                                        { "type": "text", "text": "✅ บันทึกโพยเรียบร้อย 🎉", "weight": "bold", "color": "#ffcc00", "size": "md", "align": "center" },
                                                        { "type": "separator", "color": "#333333" },
                                                        {
                                                            "type": "box", "layout": "horizontal",
                                                            "contents": [
                                                                { "type": "text", "text": "👤 ผู้แทง:", "size": "sm", "color": "#888888", "flex": 2 },
                                                                { "type": "text", "text": `${displayName} (ID: ${user.memberNumber})`, "size": "sm", "color": "#ffffff", "flex": 5, "weight": "bold" }
                                                            ]
                                                        },
                                                        { "type": "separator", "color": "#333333" },
                                                        { "type": "text", "text": "📝 รายการแทง", "size": "xs", "color": "#ffcc00", "weight": "bold" },
                                                        { "type": "box", "layout": "vertical", "spacing": "xs", "contents": itemsFlexContents },
                                                        { "type": "separator", "color": "#333333" },
                                                        {
                                                            "type": "box", "layout": "vertical", "spacing": "xs",
                                                            "contents": [
                                                                {
                                                                    "type": "box", "layout": "horizontal",
                                                                    "contents": [
                                                                        { "type": "text", "text": "💵 ยอดแทงรวม:", "size": "sm", "color": "#aaa9aa" },
                                                                        { "type": "text", "text": `${totalActualBet} บาท`, "size": "sm", "color": "#ffffff", "align": "end", "weight": "bold" }
                                                                    ]
                                                                },
                                                                {
                                                                    "type": "box", "layout": "horizontal",
                                                                    "contents": [
                                                                        { "type": "text", "text": `🔒 หักค้ำประกัน (x${maxHandMultiplier}):`, "size": "sm", "color": "#aaa9aa" },
                                                                        { "type": "text", "text": `${finalHoldCost} บาท`, "size": "sm", "color": "#ff3333", "align": "end", "weight": "bold" }
                                                                    ]
                                                                },
                                                                {
                                                                    "type": "box", "layout": "horizontal",
                                                                    "contents": [
                                                                        { "type": "text", "text": "💰 เครดิตคงเหลือ:", "size": "sm", "color": "#aaa9aa" },
                                                                        { "type": "text", "text": `${user.balance} บาท`, "size": "sm", "color": "#00ff00", "align": "end", "weight": "bold" }
                                                                    ]
                                                                }
                                                            ]
                                                        },
                                                        { "type": "separator", "color": "#333333" },
                                                        { "type": "text", "text": limitReasonText, "size": "xs", "color": "#ffaa00", "wrap": true, "align": "center" },
                                                        { "type": "text", "text": "🔔 ระบบจะคืนเครดิตส่วนต่างให้ตอนสรุปผลครับ", "size": "xxs", "color": "#888888", "align": "center" }
                                                    ]
                                                }
                                            }
                                        }]
                                    }, {
                                        headers: {
                                            'Content-Type': 'application/json',
                                            'Authorization': `Bearer ${TOKEN}`
                                        }
                                    });
                                } catch (error) {
                                    console.error("❌ ส่ง Flex Message โพยแทงล้มเหลว:", error.response ? error.response.data : error.message);
                                }
                                return; 
                            }
                        } else if (!hasError && totalActualBet === 0) {
                            replyText = "⚠️ ไม่พบรายการแทงในข้อความของคุณครับ";
                        }

                        if (hasError && errorMsg !== "") {
                            replyText = errorMsg;
                        }
                    }
                }
            }
            // ==================== [ 5. ระบบคืนโพย / ยกเลิกโพยในรอบ ] ====================
            else if (userMsg === "r") {
                if (!isRoundOpen) {
                    replyText = "🚫 ไม่สามารถคืนโพยได้ครับ เนื่องจากปิดรอบแทงเรียบร้อยแล้ว";
                } else {
                    const isRegistered = usersWallets[userId] ? true : false;
                    if (!isRegistered) {
                        replyText = `📢 คุณยังไม่ได้ลงทะเบียนสมาชิกในระบบครับ`;
                    } else {
                        const user = usersWallets[userId];
                        const myBets = roundBets[userId];

                        if (!myBets || myBets.length === 0) {
                            replyText = `❌ คุณ ${user.name} ไม่มีรายการโพยค้างในรอบนี้ให้ยกเลิกครับ`;
                        } else {
                            const totalRefund = myBets.reduce((sum, bet) => sum + bet.holdCost, 0);
                            user.balance += totalRefund;
                            
                            // 🔄 [เพิ่มจุดสำคัญ] ล้างประวัติการจำฝั่งแทงสวนออกด้วยเมื่อมีการคืนโพย เพื่อให้ส่งโพยใหม่สลับฝั่งได้ทันที
                            usersRoundCrossCheck[userId] = {};

                            await saveDataToFirebase(); //💾เซฟถาวร
                            roundBets[userId] = []; 

                            // 🚀 สั่งยิง Flex Message ดีไซน์ดำ-แดง แจ้งยกเลิกโพยทันทีตรงนี้
                            try {
                                await axios.post('https://api.line.me/v2/bot/message/reply', {
                                    replyToken: replyToken,
                                    messages: [{
                                        "type": "flex",
                                        "altText": "🗑️ ยกเลิกโพยสำเร็จเรียบร้อยแล้ว",
                                        "contents": {
                                            "type": "bubble",
                                            "styles": { "body": { "backgroundColor": "#141414" } },
                                            "body": {
                                                "type": "box", "layout": "vertical", "spacing": "md",
                                                "contents": [
                                                    { "type": "text", "text": "🗑️ ยกเลิกโพยสำเร็จเรียบร้อย 🎉", "weight": "bold", "color": "#ff3333", "size": "md", "align": "center" },
                                                    { "type": "separator", "color": "#333333" },
                                                    {
                                                        "type": "box", "layout": "horizontal",
                                                        "contents": [
                                                            { "type": "text", "text": "👤 สมาชิก:", "size": "sm", "color": "#888888", "flex": 2 },
                                                            { "type": "text", "text": `${user.name} (ID: ${user.memberNumber})`, "size": "sm", "color": "#ffffff", "flex": 5, "weight": "bold" }
                                                        ]
                                                    },
                                                    { "type": "separator", "color": "#333333" },
                                                    {
                                                        "type": "box", "layout": "vertical", "spacing": "sm",
                                                        "contents": [
                                                            {
                                                                "type": "box", "layout": "horizontal",
                                                                "contents": [
                                                                    { "type": "text", "text": "💰 คืนเครดิตค้ำประกัน:", "size": "sm", "color": "#aaa9aa" },
                                                                    { "type": "text", "text": `+${totalRefund} บาท`, "size": "sm", "color": "#00ff00", "align": "end", "weight": "bold" }
                                                                ]
                                                            },
                                                            {
                                                                "type": "box", "layout": "horizontal",
                                                                "contents": [
                                                                    { "type": "text", "text": "✨ เครดิตปัจจุบัน:", "size": "sm", "color": "#aaa9aa" },
                                                                    { "type": "text", "text": `${user.balance} บาท`, "size": "sm", "color": "#ffffff", "align": "end", "weight": "bold" }
                                                                ]
                                                            }
                                                        ]
                                                    },
                                                    { "type": "separator", "color": "#333333" },
                                                    { "type": "text", "text": "💡 ตอนนี้โพยรอบนี้ของคุณว่างแล้ว\nท่านสามารถส่งโพยชุดใหม่เข้ามาใหม่ได้ทันทีครับ", "size": "xs", "color": "#aaaaaa", "wrap": true, "align": "center" }
                                                ]
                                            }
                                        }
                                    }]
                                }, {
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Authorization': `Bearer ${TOKEN}`
                                    }
                                });
                            } catch (error) {
                                console.error("❌ ส่ง Flex Message คืนโพยล้มเหลว:", error.response ? error.response.data : error.message);
                            }
                            return; // 🌟 ทำงานเสร็จแล้วจบคำสั่งตรงนี้เลย บอทไม่รวนแน่นอน
                        }
                    }
                }
            }
            // ==================== [ 6. ระบบสมาชิกพิมพ์ขอจั่วไพ่ เช่น 12+ ] ====================
            else if (userMsg.endsWith('+')) {
                if (!isDrawOpen) {
                    replyText = "⚠️ ระบบยังไม่ได้เปิดรอบจั่วไพ่ใบที่ 3 หรือ แอดมินปิดรอบจั่วไปแล้วครับ";
                } else {
                    const userBetsArray = roundBets[userId];
                    if (!userBetsArray || userBetsArray.length === 0) {
                        replyText = "⚠️ คุณยังไม่ได้ส่งโพยเดิมพันในรอบนี้ จึงไม่สามารถขอจั่วไพ่ได้ครับ";
                    } else {
                        const legsToDraw = userMsg.replace('+', '').split('');
                        let drawSuccessLegs = [];
                        let alreadyDrawnLegs = []; // 📌 [เพิ่มใหม่] เก็บขาที่เคยจั่วไปแล้ว เพื่อนำมาแจ้งเตือน

                        userBetsArray.forEach((bet) => {
                            // 👑 [จุดแก้ไขบั๊ก] เช็กว่าโพยใบนี้เป็นโพยแทงฝั่งเจ้ามือสู้ขา (จ) หรือเหมาเจ้า (รจ) หรือไม่
                            const isBettingOnDealer = (bet.betType === "รจ" || bet.betType.startsWith('จ'));
                            
                            // 🛑 ถ้าเป็นโพยแทงฝั่งเจ้ามือ ให้ข้ามไปเลย ไม่ทำการเปิดสิทธิ์จั่วเด็ดขาด
                            if (isBettingOnDealer) return;

                            // 👤 ปรับสถานะเฉพาะโพยฝั่งผู้เล่นปกติเท่านั้น
                            if (!bet.drawStatus) bet.drawStatus = {};

                            legsToDraw.forEach((leg) => {
                                let hasThisLeg = false;
                                if (bet.betType === "รข") {
                                    hasThisLeg = ['1', '2', '3', '4','5', '6'].includes(leg);
                                } else {
                                    hasThisLeg = bet.betType.includes(leg);
                                }

                                if (hasThisLeg) {
                                   // 🚨 [จุดแก้ไขหลัก]: เช็กว่าขานี้เคยจั่วไปแล้วหรือยัง?
                        if (bet.drawStatus[leg] === "จั่ว") {
                            // ถ้าเคยจั่วไปแล้ว ให้เก็บบันทึกไว้ว่าส่งซ้ำ (ไม่ใส่ใน drawSuccessLegs)
                            if (!alreadyDrawnLegs.includes(leg)) {
                                alreadyDrawnLegs.push(leg);
                            }
                        } else {
                            // 🟢 ถ้ายังไม่เคยจั่ว ให้ปรับสถานะ และบันทึกการจั่วสำเร็จ
                            bet.drawStatus[leg] = "จั่ว";
                            if (!drawSuccessLegs.includes(leg)) {
                                drawSuccessLegs.push(leg);
                            }
                        }
                    }
                });
            });

                        if (drawSuccessLegs.length > 0) {
                            const sortedLegs = drawSuccessLegs.sort((a, b) => a - b).join(', ');
                            const user = usersWallets[userId] || {};

                            // 💡 ดึงชื่อเล่น (ถ้าน้าไม่ได้ตั้ง nickname ไว้ ระบบจะถอยไปใช้ user.name อัตโนมัติ)
                            const displayName = user.nickname || user.name || "สมาชิก";
                            
                            // 🚀 สั่งยิง Flex Message ดีไซน์ดำ-น้ำเงิน แจ้งขอจั่วไพ่ใบที่ 3 ทันทีตรงนี้
                            try {
                                await axios.post('https://api.line.me/v2/bot/message/reply', {
                                    replyToken: replyToken,
                                    messages: [{
                                        "type": "flex",
                                        "altText": "🃏 ${displayName} บันทึกการขอจั่วไพ่ใบที่ 3 สำเร็จ",
                                        "contents": {
                                            "type": "bubble",
                                            "styles": { "body": { "backgroundColor": "#121620" } },
                                            "body": {
                                                "type": "box", "layout": "vertical", "spacing": "md",
                                                "contents": [
                                                    { "type": "text", "text": "🃏 ขอจั่วไพ่ใบที่ 3 สำเร็จ 🎉", "weight": "bold", "color": "#3399ff", "size": "md", "align": "center" },
                                                    { "type": "separator", "color": "#222a3a" },
                                                    {
                                                        "type": "box", "layout": "horizontal",
                                                        "contents": [
                                                            { "type": "text", "text": "👤 ผู้จั่ว:", "size": "sm", "color": "#8894a6", "flex": 2 },
                                                            { "type": "text", "text": `[ ${user.memberNumber || '-'} ] ${displayName}`, "size": "sm", "color": "#ffffff", "flex": 5, "weight": "bold" }
                                                        ]
                                                    },
                                                    { "type": "separator", "color": "#222a3a" },
                                                    {
                                                        "type": "box", "layout": "vertical", "spacing": "xs",
                                                        "contents": [
                                                            { "type": "text", "text": "📍 ขาที่ต้องการจั่วเพิ่ม", "size": "xs", "color": "#3399ff", "weight": "bold" },
                                                            {
                                                                "type": "box", "layout": "horizontal", "spacing": "sm", "margin": "sm",
                                                                "contents": [
                                                                    { "type": "text", "text": "➡️ ขาผู้เล่น:", "size": "sm", "color": "#aaa9aa", "flex": 3 },
                                                                    { "type": "text", "text": `[ ขา ${sortedLegs} ]`, "size": "sm", "color": "#00ff00", "weight": "bold", "flex": 5 }
                                                                ]
                                                            }
                                                        ]
                                                    },
                                                    { "type": "separator", "color": "#222a3a" },
                                                    { "type": "text", "text": "📢 สถานะ: รอดำเนินการจั่วไพ่จากแอดมิน", "size": "xs", "color": "#aaaaaa", "align": "center" }
                                                ]
                                            }
                                        }
                                    }]
                                }, {
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Authorization': `Bearer ${TOKEN}`
                                    }
                                });
                            } catch (error) {
                                console.error("❌ ส่ง Flex Message ขอจั่วไพ่ล้มเหลว:", error.response ? error.response.data : error.message);
                            }
                            return; // 🌟 ทำงานเสร็จแล้ว ตัดจบตรงนี้เลย
                            
                            // 🔴 กรณีที่กดพิมพ์จั่วซ้ำ (ไม่มีขาใหม่ให้จั่วแล้ว)
                        } else if (alreadyDrawnLegs.length > 0) {
                const dupLegs = alreadyDrawnLegs.sort((a, b) => a - b).join(', ');
                replyText = `⚠️ ขา [ ${dupLegs} ] ของคุณได้บันทึกการขอจั่วไปแล้วครับ ไม่สามารถจั่วซ้ำได้!`;
            
            // 🟡 กรณีพิมพ์ขาที่ตัวเองไม่ได้แทงไว้
            } else {
                replyText = "⚠️ คำสั่งไม่ทำงาน: เนื่องจากคุณไม่ได้ลงเดิมพันในขาที่คุณระบุจั่ว หรือแทงเฉพาะฝั่งเจ้ามือไว้ครับ";
            }
        }
    }
}
             // ==================== [ 8. ระบบแอดมินส่งผลสรุปคำนวณแต้ม - เวอร์ชันพ่วง Flex Message ] ====================
else if (originalMsg.startsWith('>')) {
    if (!ADMIN_IDS.includes(userId)) {
        replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งสรุปผลคะแนนครับ";
    } else if (isRoundOpen) {
        replyText = "⚠️ ต้องพิมพ์ปิดรอบแทง (X) และทำขั้นตอนจั่วไพ่ให้เสร็จก่อน จึงจะสรุปผลได้ครับ";
    } else {
        let textWithoutArrow = originalMsg.substring(1).trim();
        const parts = textWithoutArrow.split(/\s+/); // แยกชิ้นส่วนด้วยเว้นวรรคหรือขึ้นบรรทัดใหม่
        
        if (parts.length < 2) {
            replyText = "⚠️ รูปแบบผิดครับน้า! ต้องพิมพ์เรียง ขา1 ขา2 ... และตัวสุดท้ายคือเจ้ามือ (คั่นด้วยเว้นวรรค)";
            return res.sendStatus(200);
        }

        // 🛠️ ฟังก์ชันแกะรหัสไพ่ (นับสแลชแม่นยำ ไม่โดนตัวอื่นแย่ง)
        const parseCardStr = (str, isDealer = false, isThreeCards = false, forcePok = false) => {
            let clean = str.trim().toLowerCase();
            let isPok = forcePok; 
            let multiplier = 1; 
            let typeName = "แต้มปกติ";
            let rawScore = 0;

            // 🎯 นับเครื่องหมาย / เพื่อคิดเด้งแบบตรงตัว
            const slashCount = (clean.match(/\//g) || []).length;
            if (slashCount === 2) { multiplier = 3; }
            else if (slashCount === 1) { multiplier = 2; }
            
            // ลบเครื่องหมาย / ออกทั้งหมดเพื่อส่องดูแต้มเนื้อๆ
            clean = clean.replace(/\//g, '');

            // เช็กป๊อกเจ้ามือ
            if (isDealer && clean.includes('*')) { isPok = true; clean = clean.replace('*', ''); }

            // แปลงแต้มพิเศษ (รองรับทั้งไทยและอังกฤษ)
            if (clean === 't' || clean === 'ต') { rawScore = 700; multiplier = 5; typeName = "ตอง"; } 
            else if (clean === 'sf') { rawScore = 600; multiplier = 5; typeName = "สเตฟฟลัช"; } 
            else if (clean === 'h') { rawScore = 500; multiplier = 3; typeName = "เซียน/3เหลือง"; } 
            else if (clean === 's' || clean === 'ร') { rawScore = 400; multiplier = 3; typeName = "เรียง"; } 
            else {
                let pts = parseInt(clean);
                if (isNaN(pts)) pts = 0;
                
                // สำหรับผู้เล่น ถ้าแต้มเป็น 8 หรือ 9 โดดๆ ให้ถือเป็นไพ่ป๊อกอัตโนมัติ
                if (isPok) {
            if (pts === 9) { rawScore = 900; typeName = "ป๊อก 9"; }
            else if (pts === 8) { rawScore = 800; typeName = "ป๊อก 8"; }
            else { rawScore = pts; typeName = `${pts} แต้ม`; }
        } else {
            rawScore = pts; typeName = `${pts} แต้ม`;
        }
    }
    return { score: rawScore, v: clean, mult: multiplier, name: typeName };
};

        // 👑 แกะรหัสเจ้ามือ (ตัวสุดท้าย)
        const dealerRawStr = parts[parts.length - 1]; 
        const dealerResult = parseCardStr(dealerRawStr, true, false);

        let roomResults = {}; 
        const totalLegsToSend = Math.min(parts.length - 1, 6);

        // 🔄 วนลูปแกะรหัสผู้เล่นรายขา
        for (let i = 0; i < totalLegsToSend; i++) {
            let innerContent = parts[i].trim();
            if (innerContent === "") continue;

            let currentLeg = i + 1;
            let result2Cards = null;
            let result3Cards = null;

            // 🔥 [ใช้ระบบ RegEx ชำแหละข้อความขั้นสูง] แยกกลุ่มตัวเลขและเครื่องหมายสแลชออกจากกัน
           if (innerContent.includes(',')) {
    // 1. ถ้าแอดมินพิมพ์แบบมีคอมม่าคั่น เช่น 5,sf หรือ 1,s
    const splitParts = innerContent.split(',');
    const part1 = splitParts[0].trim();
    const part2 = splitParts[1].trim();
    
    result2Cards = parseCardStr(part1, false, false);
    result3Cards = parseCardStr(part2, false, true);
} else {
    // 2. ถ้าพิมพ์ติดกันแบบปกติ ไม่มีคอมม่า ให้ใช้ RegEx ช่วยผ่าแยก
    const match = innerContent.match(/^([0-9tshfตร]+(?:\/*))([0-9tshfตร]+(?:\/*))$/i);
    
    if (match) {
        const part1 = match[1]; 
        const part2 = match[2]; 
        
        result2Cards = parseCardStr(part1, false, false);
        result3Cards = parseCardStr(part2, false, true);
    } else {
            // กรณีพิมพ์ตัวเดียวโดดๆ
                let pts = parseInt(innerContent);
                if (!isNaN(pts) && (pts === 8 || pts === 9)) {
                    result2Cards = parseCardStr(innerContent, false, false, true);
                    result3Cards = parseCardStr(innerContent, false, true, true);
                } else {
                    result2Cards = parseCardStr(innerContent, false, false, false);
                    result3Cards = parseCardStr(innerContent, false, true, false);
                }
            }
           }
            roomResults[currentLeg] = {
                leg: currentLeg,
                twoCards: result2Cards,
                threeCards: result3Cards
            };
        }

        tempRoomResults = roomResults;
        tempDealerResult = dealerResult;

        // --- 📊 [ส่วนสร้างโครงสร้างข้อมูลจัดระเบียบส่งเข้า Flex Message] ---
        let legsFlexContents = [];

        for (let leg = 1; leg <= 6; leg++) {
            if (roomResults[leg]) {
                const res = roomResults[leg];
                
                let status2Str = "เสมอ 🟡"; let color2 = "#ffcc00";
                if (res.twoCards.score > dealerResult.score) { status2Str = "ชนะ 🟢"; color2 = "#00ff66"; }
                else if (res.twoCards.score < dealerResult.score) { status2Str = "แพ้ 🔴"; color2 = "#ff3333"; }

                let status3Str = "เสมอ 🟡"; let color3 = "#ffcc00";
                if (res.threeCards.score > dealerResult.score) { status3Str = "ชนะ 🟢"; color3 = "#00ff66"; }
                else if (res.threeCards.score < dealerResult.score) { status3Str = "แพ้ 🔴"; color3 = "#ff3333"; }

                legsFlexContents.push({
                    "type": "box",
                    "layout": "vertical",
                    "margin": "md",
                    "spacing": "xs",
                    "contents": [
                        { "type": "text", "text": `🃏 ขาที่ ${leg}`, "weight": "bold", "color": "#ffffff", "size": "sm" },
                        {
                            "type": "box",
                            "layout": "horizontal",
                            "contents": [
                                { "type": "text", "text": `• [2ใบ]: ${res.twoCards.name} (${res.twoCards.mult}เด้ง)`, "size": "xs", "color": "#cccccc" },
                                { "type": "text", "text": status2Str, "size": "xs", "color": color2, "align": "end", "weight": "bold" }
                            ]
                        },
                        {
                            "type": "box",
                            "layout": "horizontal",
                            "contents": [
                                { "type": "text", "text": `• [3ใบ]: ${res.threeCards.name} (${res.threeCards.mult}เด้ง)`, "size": "xs", "color": "#cccccc" },
                                { "type": "text", "text": status3Str, "size": "xs", "color": color3, "align": "end", "weight": "bold" }
                            ]
                        },
                        { "type": "separator", "color": "#2a2233", "margin": "xs" }
                    ]
                });
            } else {
                legsFlexContents.push({
                    "type": "box",
                    "layout": "horizontal",
                    "margin": "xs",
                    "contents": [
                        { "type": "text", "text": `🃏 ขาที่  ${leg}: ⚠️ ไม่มีผลไพ่`, "size": "xs", "color": "#888888", "style": "italic" },
                        { "type": "text", "text": "แพ้ 🔴", "size": "xs", "color": "#ff3333", "align": "end", "weight": "bold" }
                    ]
                });
            }
        }

        // 🚀 ยิงข้อความแพ็คคู่: รูปภาพหัวข้อผลลัพธ์ + Flex Message สรุปผลคะแนน
        const summaryImgUrl = "https://img2.pic.in.th/-__-----4b1c38e0628ea626.jpg";

        try {
            await axios.post('https://api.line.me/v2/bot/message/reply', {
                replyToken: replyToken,
                messages: [
                    {
                        "type": "image",
                        "originalContentUrl": summaryImgUrl,
                        "previewImageUrl": summaryImgUrl
                    },
                    {
                        "type": "flex",
                        "altText": `📊 ตรวจสอบผลการเล่น รอบที่ ${currentRound}`,
                        "contents": {
                            "type": "bubble",
                            "styles": { "body": { "backgroundColor": "#130f17" } },
                            "body": {
                                "type": "box",
                                "layout": "vertical",
                                "spacing": "md",
                                "contents": [
                                    { "type": "text", "text": "📊 ตรวจสอบผลการเล่นผลคะแนน 🎰", "weight": "bold", "color": "#b8860b", "size": "md", "align": "center" },
                                    { "type": "text", "text": `รอบที่: ${currentRound}`, "weight": "bold", "color": "#ffffff", "size": "sm", "align": "center" },
                                    { "type": "separator", "color": "#2a2233" },
                                    {
                                        "type": "box",
                                        "layout": "horizontal",
                                        "backgroundColor": "#221929",
                                        "contents": [
                                            { "type": "text", "text": "👑 เจ้ามือ:", "weight": "bold", "color": "#ffaa00", "size": "sm" },
                                            { "type": "text", "text": `${dealerResult.name} (${dealerResult.mult} เด้ง)`, "weight": "bold", "color": "#ffffff", "size": "sm", "align": "end" }
                                        ]
                                    },
                                    { "type": "separator", "color": "#2a2233" },
                                    { "type": "text", "text": "📝 ลำดับหน้าไพ่และผลแพ้ชนะแต่ละขา", "size": "xs", "color": "#ffaa00", "weight": "bold" },
                                    { "type": "box", "layout": "vertical", "spacing": "xs", "contents": legsFlexContents },
                                    { "type": "separator", "color": "#2a2233" },
                                  // 🔘 [เพิ่มใหม่]: ชุดปุ่มกด ยืนยัน (ok) / ยกเลิก (no)
                            {
                                "type": "box",
                                "layout": "horizontal",
                                "spacing": "sm",
                                "margin": "md",
                                "contents": [
                                    {
                                        "type": "button",
                                        "style": "primary",
                                        "color": "#00c853", // สีเขียว
                                        "height": "sm",
                                        "action": {
                                            "type": "message",
                                            "label": "✅ ยืนยัน",
                                            "text": "ok" // คำสั่งที่ส่งเข้าแชทเมื่อกดปุ่ม
                                        }
                                    },
                                    {
                                        "type": "button",
                                        "style": "primary",
                                        "color": "#d32f2f", // สีแดง
                                        "height": "sm",
                                        "action": {
                                            "type": "message",
                                            "label": "❌ ยกเลิก",
                                            "text": "no" // คำสั่งที่ส่งเข้าแชทเมื่อกดปุ่ม
                                        }
                                    }
                                ]
                            }
                        ]
                    }
                }
            }
        ]
    }, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${TOKEN}`
        }
    });
} catch (error) {
    console.error("❌ ส่งรูปภาพและ Flex ตรวจสอบผลล้มเหลว:", error.response ? error.response.data : error.message);
}
return res.sendStatus(200);
    }
}
  // ==================== [ 9. ระบบแอดมินยืนยันผลคำนวณเงินจริง OK / NO (Settlement Engine) ] ====================
else if (userMsg === 'ok' || userMsg === 'no') {
    if (!ADMIN_IDS.includes(userId)) return;

    if (!tempRoomResults || !tempDealerResult) {
        replyText = "⚠️ ไม่มีข้อมูลผลแต้มค้างอยู่ในระบบครับ กรุณาส่งผลแต้มด้วยเครื่องหมาย > ก่อนครับ";
    } else {
        if (userMsg === 'ok') {
            let summaryPayoutText = `💰 สรุปยอดได้/เสีย รอบที่: ${currentRound}\n──────────────────\n`;
            summaryPayoutText += `👑 เจ้ามือ: ${tempDealerResult.name}\n──────────────────\n`;
            
            let hasAnyBet = false;
            let flexUserContents = []; // 🎨 อาเรย์สำหรับเก็บดีไซน์กล่องรายคนใน Flex Message

            // วนลูปสมาชิกทุกคนที่มีการแทงในรอบนี้เพื่อคิดเงิน
            for (let uId in roundBets) {
                try {
                    const userBetsArray = roundBets[uId];
                if (!userBetsArray || userBetsArray.length === 0) continue;
                    
                const user = usersWallets[uId];
                // 🚨 [เพิ่มจุดนี้] ป้องกันระบบล่มถ้าหา Wallet สมาชิกไม่เจอ
                if (!user) {
                    console.error(`⚠️ ไม่พบข้อมูล usersWallets ของ userId: ${uId}`);
                    continue; // ให้ข้ามไปคิดเงินคนถัดไป ไม่ให้ลูปค้าง/ดับ
                }

                // 💡 ดึงชื่อเล่น (ถ้าน้าไม่ได้ตั้ง nickname ไว้ ระบบจะถอยไปใช้ user.name อัตโนมัติ)
                const displayName = user.nickname || user.name || "สมาชิก";
                    
                hasAnyBet = true;
                let userTotalWinLoss = 0; 
                let totalHoldRefund = 0;   
                let totalBetAmountThisRound = 0; // 📊 ตัวแปรเพิ่มใหม่สำหรับเก็บยอดแทงรวมแท้จริงในตานี้เพื่อเอาไปคิดเทิร์น

                userBetsArray.forEach((bet) => {
                    totalHoldRefund += bet.holdCost; // ดึงเงินค้ำประกัน 3 เท่ากลับมาคืนก่อน

                    // แกะข้อมูลตามประเภทโพย (เช่น "1", "รข", "จ12")
                    let legsToCalculate = [];
                    if (bet.betType === "รข" || bet.betType === "รจ") {
                        legsToCalculate = ['1', '2', '3', '4', '5', '6'];
                    } else if (bet.betType.startsWith('จ')) {
                        legsToCalculate = bet.betType.substring(1).split('');
                    } else {
                        legsToCalculate = bet.betType.split('');
                    }

                    // 🧮 สะสมยอดเดิมพันรวมจากราคารายขาคูณจำนวนขาที่เปิดสู้จริงในตานี้
                    totalBetAmountThisRound += (bet.pricePerLeg * legsToCalculate.length);

                    // คำนวณเงินแยกตามรายขาในโพยใบนี้
                    legsToCalculate.forEach((leg) => {
                        const legNum = parseInt(leg);
                        const matchResult = tempRoomResults[legNum];
                        if (!matchResult) return; // ป้องกันกรณีขาไม่มีข้อมูลผล
                        
                        // 🔍 ตรวจสอบประเภทโพย: เป็นการแทงฝั่งเจ้ามือสู้ขาผู้เล่นใช่หรือไม่
                        const isBettingOnDealer = (bet.betType === "รจ" || bet.betType.startsWith('จ'));

                        let finalCard;
                        const betPrice = bet.pricePerLeg; // ยอดแทงต่อ 1 ขา

                        if (!isBettingOnDealer) {
                            // 👤 [ฝั่งคนแทงผู้เล่นปกติ] -> รันระบบเดิมของคุณที่สมบูรณ์แบบอยู่แล้ว 100%
                            const isUserDrawn = (bet.drawStatus && bet.drawStatus[leg] === "จั่ว");
                            finalCard = isUserDrawn ? matchResult.threeCards : matchResult.twoCards;
                            // 🟢 ฝั่งผู้เล่นชนะ:
                            if (finalCard.score > tempDealerResult.score) {
                                let winMultiplier = finalCard.mult;
                                // 🛡️ ถ้าค้ำประกันมาแค่ 2 เด้ง ชนะเท่าไหร่ก็โดนแคปให้ได้ไม่เกิน 2 เด้ง (ถ้าค้ำครบ 3 เด้งจะปล่อยได้เต็ม 5 เด้ง)
                                if (bet.maxMultiplier && bet.maxMultiplier < 3 && winMultiplier > bet.maxMultiplier) {
                                    winMultiplier = bet.maxMultiplier;
                                }
                                userTotalWinLoss += (betPrice * winMultiplier);
                            } 
                            // 🔴 ฝั่งผู้เล่นแพ้:
                            else if (finalCard.score < tempDealerResult.score) {
                                let loseMultiplier = tempDealerResult.mult;
                                // ล็อกเพดานแพ้สูงสุดไม่เกิน 3 เด้งสำหรับคนค้ำครบ
                                if (loseMultiplier > 3) {
                                loseMultiplier = 3;
                                }
                                // 🛡️ ถ้าค้ำประกันมาน้อยกว่า (เช่น 2 เด้ง) ก็หักแพ้ตามเพดานค้ำจริง (ไม่เกิน 2)
                                if (bet.maxMultiplier && loseMultiplier > bet.maxMultiplier) {
                                    loseMultiplier = bet.maxMultiplier;
                                }
                                userTotalWinLoss -= (betPrice * loseMultiplier);
                            }
                        }
                        else {
                            // 👑 [ฝั่งคนแทงเจ้ามือ (จ หรือ มจ)] -> ใช้กฎตายตัวแยกคำนวณเด็ดขาด
                            let playerTwoCardScore = matchResult.twoCards.score;
                            let playerTwoCardMult = matchResult.twoCards.mult;

                            // รันกฎตายตัว: ขาผู้เล่นได้ 4 แต้มหรือต่ำกว่า (และไม่ใช่ 4 แต้มเด้ง) ให้เจ้ามือไปสู้กับผล 3 ใบ
                            if (playerTwoCardScore <= 4 || (playerTwoCardScore === 4 && playerTwoCardMult === 1)) {
                                finalCard = matchResult.threeCards; // ชนกับผลไพ่ 3 ใบ
                            } else {
                                finalCard = matchResult.twoCards;   // ชนกับผลไพ่ 2 ใบ (5 แต้มขึ้นไป หรือ 4 แต้มเด้ง)
                            }

                            // 🧮 ตรรกะคิดเงินของฝั่งคนแทงเจ้ามือ (หักต๋ง 10% เฉพาะขาที่ได้กำไร)
                            if (tempDealerResult.score > finalCard.score) {
                                let winMultiplier = tempDealerResult.mult; // ไม่ต้องเอา bet.maxMultiplier มาล็อคแล้ว                              
                                if (tempDealerResult.rawMult) {
                                    winMultiplier = tempDealerResult.rawMult;
                                }
                                // 🛡️ ถ้าค้ำประกันมาแค่ 2 เด้ง ชนะเท่าไหร่ก็โดนแคปไม่เกิน 2 เด้ง (ถ้าค้ำครบ 3 เด้งปล่อยได้เต็ม)
                                if (bet.maxMultiplier && bet.maxMultiplier < 3 && winMultiplier > bet.maxMultiplier) {
                                    winMultiplier = bet.maxMultiplier;
                                 }
                                
                                let grossWin = betPrice * winMultiplier; // กำไรเต็มก่อนหัก
                                
                                // 🔥 หักต๋งรายขาทันที 10% (เหลือจ่ายจริง 90%)
                                let netWin = Math.floor(grossWin * 0.9);
                                userTotalWinLoss += netWin;
                            } 
                           // 🔴 ฝั่งคนแทงเจ้ามือแพ้:
                        else if (tempDealerResult.score < finalCard.score) {
                            let loseMultiplier = finalCard.mult;
                            // ล็อกเพดานแพ้สูงสุดไม่เกิน 3 เด้งสำหรับคนค้ำครบ
                            if (loseMultiplier > 3) {
                            loseMultiplier = 3;
                            }
                            // 🛡️ ถ้าค้ำประกันมาน้อยกว่า (เช่น 2 เด้ง) หักแพ้ไม่เกินเพดานค้ำจริง
                            if (bet.maxMultiplier && loseMultiplier > bet.maxMultiplier) {
                            loseMultiplier = bet.maxMultiplier;
                            }
                            userTotalWinLoss -= (betPrice * loseMultiplier);
                            }
                        }
                    });
                }); // ปิด userBetsArray.forEach

                // 🧮 อัปเดตกระเป๋าเงินจริงหลังคิดยอดสุทธิ
                user.balance = user.balance + totalHoldRefund + userTotalWinLoss;

                // 📊 [ระบบคำนวณและหักยอดเทิร์นอัตโนมัติ - เวอร์ชันสากลหักตามยอดแทงจริงที่มีผลได้เสีย]
                if (user.turnoverTarget > 0 && userTotalWinLoss !== 0) {
                    let currentTurnoverMade = totalBetAmountThisRound; // หักลดลงเท่ากับยอดแทงจริง ไม่สนจำนวนเด้ง
                    user.turnoverTarget -= currentTurnoverMade;
                    if (user.turnoverTarget < 0) user.turnoverTarget = 0; 
                }

                let sign = userTotalWinLoss > 0 ? "+" : "";
                let displayColor = userTotalWinLoss > 0 ? "#00ff66" : (userTotalWinLoss < 0 ? "#ff3333" : "#ffcc00");
                
                let isUserBettingOnDealer = userBetsArray.some(b => b.betType === "รจ" || b.betType.startsWith('จ'));
                let feeNote = (isUserBettingOnDealer && userTotalWinLoss !== 0) ? " (หักต๋งแล้ว)" : "";

                // 🛠️ ประกอบร่างดีไซน์ Flex รายบุคคล
                flexUserContents.push({
                    "type": "box",
                    "layout": "vertical",
                    "margin": "md",
                    "spacing": "xs",
                    "contents": [
                        { "type": "text", "text": `👤 [ ${user.memberNumber || '-'} ] ${displayName}`, "weight": "bold", "color": "#ffffff", "size": "sm" },
                        {
                            "type": "box",
                            "layout": "horizontal",
                            "contents": [
                                { "type": "text", "text": `• ยอดสุทธิ:${feeNote}`, "size": "xs", "color": "#cccccc" },
                                { "type": "text", "text": `${sign}${userTotalWinLoss} บาท`, "size": "xs", "color": displayColor, "align": "end", "weight": "bold" }
                            ]
                        },
                        {
                            "type": "box",
                            "layout": "horizontal",
                            "contents": [
                                { "type": "text", "text": `• เครดิตคงเหลือ:`, "size": "xs", "color": "#cccccc" },
                                { "type": "text", "text": `${user.balance} บ.`, "size": "xs", "color": "#ffffff", "align": "end" }
                            ]
                        },
                        { "type": "separator", "color": "#2a2233", "margin": "xs" }
                    ]
                });

                // เก็บลงตัวแปร text ระบบเดิมด้วยเพื่อไม่ให้ระบบหลังบ้านรวน
                let oldSign = userTotalWinLoss > 0 ? "🟢 +" : (userTotalWinLoss < 0 ? "🔴 " : "🟡 ");
                let oldFeeNote = (isUserBettingOnDealer && userTotalWinLoss !== 0) ? " \n(หักต๋งขาเจ้ามือที่ชนะแล้ว)" : "";
                summaryPayoutText += `👤 [ ${user.memberNumber || '-'} ] ${displayName}\n  ยอดสุทธิ: ${oldSign}${userTotalWinLoss} บาท${oldFeeNote}\n เครดิตคงเหลือ: ${user.balance} บ.\n──────────────────\n`;
            } catch (error) {
                 // 🛡️ หากเกิด Error กับคนไหน ให้พ่น Log บอก แล้วไปคิดเงินคนถัดไปทันที ลูปไม่ดับแน่นอน
                 console.error(`❌ เกิดข้อผิดพลาดในการคิดเงินของ uId ${uId}:`, error);
            }    
        } // ปิดลูป for (let uId in roundBets)

            // 🛡️ เซฟลง Firebase แบบปลอดภัย หาก DB กระตุก บอทจะไม่ค้างและยังส่ง Flex สรุปยอดได้ปกติ
        try {
            await saveDataToFirebase();
        } catch (dbError) {
            console.error("❌ เกิดข้อผิดพลาดขณะเซฟลง Firebase:", dbError);
        }

            if (!hasAnyBet) {
                summaryPayoutText += "📝 รอบนี้ไม่มีสมาชิกส่งโพยเดิมพันเข้ามาครับ\n";
                flexUserContents.push({
                    "type": "text",
                    "text": "📝 รอบนี้ไม่มีสมาชิกส่งโพยเดิมพันเข้ามาครับ",
                    "size": "xs",
                    "color": "#888888",
                    "style": "italic",
                    "align": "center"
                });
            }

            summaryPayoutText += `✨ ระบบได้ทำการคำนวณเงินและอัปเดตกระเป๋าเงินให้ทุกคนเรียบร้อยแล้วครับ 🏁`;
            
            // 📊 [ระบบบันทึกสถิติแบบละเอียดแยกขา - เวอร์ชันโชว์ไพ่ 2 ใบ และ 3 ใบ] 
            let dealerDisplay = ""; 
            if (tempDealerResult.name.includes("ป๊อก 9")) dealerDisplay = "9ป";
            else if (tempDealerResult.name.includes("ป๊อก 8")) dealerDisplay = "8ป";
            else if (tempDealerResult.name.includes("ตอง")) dealerDisplay = "ตอง";
            else if (tempDealerResult.name.includes("สเตฟฟลัช")) dealerDisplay = "สเตฟ";
            else if (tempDealerResult.name.includes("เซียน")) dealerDisplay = "เซียน";
            else if (tempDealerResult.name.includes("เรียง")) dealerDisplay = "เรียง";
            else dealerDisplay = `${tempDealerResult.score}แต้ม`;

            let historySummary = `รอบที่ ${currentRound}: [👑${dealerDisplay}] ⚔️\n`;
            let roomRows = [];

            for (let leg = 1; leg <= 6; leg++) {
                if (tempRoomResults[leg]) {
                    const legRes = tempRoomResults[leg];

                    // 1. เช็กไพ่ 2 ใบ ชนกับเจ้ามือ (ชนะ=🟢, แพ้=🔴, เสมอ=🟡)
                    let dotCard2 = "🟡";
                    if (tempDealerResult.score > legRes.twoCards.score) dotCard2 = "🔴";
                    else if (tempDealerResult.score < legRes.twoCards.score) dotCard2 = "🟢";

                    // 2. เช็กไพ่ 3 ใบ ชนกับเจ้ามือ (ชนะ=🟢, แพ้=🔴, เสมอ=🟡)
                    let dotCard3 = "🟡";
                    if (tempDealerResult.score > legRes.threeCards.score) dotCard3 = "🔴";
                    else if (tempDealerResult.score < legRes.threeCards.score) dotCard3 = "🟢";

                    roomRows.push(`[${leg}${dotCard2}ll${dotCard3}]`);
                } else {
                    // หากห้องนั้นไม่มีข้อมูล ให้ถือว่าแพ้ทั้งคู่ (🔴)
                    roomRows.push(`[${leg}🔴I🔴]`);
                }
            }

            // จัดหน้าแบ่งเป็น 2 แถว แถวละ 3 ห้องตามสไตล์ที่น้าต้องการ
            historySummary += `${roomRows[0]} ${roomRows[1]} ${roomRows[2]}\n${roomRows[3]} ${roomRows[4]} ${roomRows[5]}`;
            
            matchHistory.push(historySummary);
            if (matchHistory.length > 5) matchHistory.shift(); 

            pastRoundsData[currentRound] = {
                dealer: JSON.parse(JSON.stringify(tempDealerResult)),
                rooms: JSON.parse(JSON.stringify(tempRoomResults)),
                bets: JSON.parse(JSON.stringify(roundBets))
            };
            
           // ==================== [ส่วนแปลงเป็น CAROUSEL สไลด์ข้าง] ====================
// 1. ตัดแบ่ง flexUserContents ออกเป็นหน้าๆ (แนะนำหน้าละ 3 คนเพื่อให้เห็นยอดคงเหลือชัดเจน)
const chunkSize = 7; 
const userPages = [];
for (let i = 0; i < flexUserContents.length; i += chunkSize) {
    userPages.push(flexUserContents.slice(i, i + chunkSize));
}

// ป้องกันกรณีไม่มีผู้เล่นในรอบ
if (userPages.length === 0) {
    userPages.push([{ "type": "text", "text": "ไม่มีรายการคำนวณในรอบนี้", "color": "#aaaaaa", "size": "xs", "align": "center" }]);
}

// 2. สร้างการ์ด Carousel
const winLossBubbles = userPages.map((pageContents, index) => {
    const isLastPage = index === userPages.length - 1;

    return {
        "type": "bubble",
        "styles": {
            "body": { "backgroundColor": "#191424" } // 🎨 ใช้สีม่วงดำสำหรับสรุปผล
        },
        "body": {
            "type": "box",
            "layout": "vertical",
            "spacing": "md",
            "contents": [
                { "type": "text", "text": "💰 สรุปยอดได้/เสีย ประจำรอบ 🎉", "weight": "bold", "color": "#ffaa00", "size": "md", "align": "center" },
                { "type": "text", "text": `รอบที่: ${currentRound} (หน้า ${index + 1}/${userPages.length})`, "weight": "bold", "color": "#ffffff", "size": "xl", "align": "center", "margin": "none" },
                { "type": "text", "text": `👑 เจ้ามือ: ${tempDealerResult.name}`, "size": "xs", "color": "#aaaaaa", "align": "center" },
                { "type": "separator", "color": "#2a2a35" },
                
                // 👤 รายชื่อสมาชิก
                {
                    "type": "box",
                    "layout": "vertical",
                    "spacing": "sm",
                    "contents": pageContents
                },
                
                { "type": "separator", "color": "#2a2a35" },
                { "type": "text", "text": "✅ ระบบทำการเคลียร์ยอดเงินในรอบนี้เสร็จสิ้นแล้วครับ!", "size": "xs", "color": "#00ff66", "align": "center", "weight": "bold" },
                
                // 🔘 ถ้าเป็นหน้าสุดท้าย ให้แสดงปุ่มกดเปิดรอบถัดไปได้ทันที
                ...(isLastPage ? [
                    {
                        "type": "button",
                        "style": "primary",
                        "color": "#ffaa00",
                        "height": "sm",
                        "margin": "md",
                        "action": {
                            "type": "message",
                            "label": "🚀 เปิดรอบแทงถัดไป",
                            "text": "o" // 👈 เปลี่ยนเป็นคำสั่งเปิดรอบของน้าได้เลยครับ
                        }
                    }
                ] : [])
            ]
        }
    };
});

// 3. กำหนดค่า Carousel Flex
global.currentReplyFlex = {
    "type": "flex",
    "altText": `💰 สรุปยอดได้/เสีย รอบที่: ${currentRound}`,
    "contents": {
        "type": "carousel",
        "contents": winLossBubbles
    }
};
// =========================================================================
            // กำหนดให้ส่งทั้งข้อความธรรมดา (เก็บประวัติ) และแนบกล่องดีไซน์ไปด้วยครับน้า
            tempRoomResults = null;
            tempDealerResult = null;
            roundBets = {};
            
            replyText = ""; 
        }     
        else if (userMsg === 'no') {
            replyText = "❌ แอดมินยกเลิกผลคำนวณรอบนี้เรียบร้อยครับ สามารถส่งแต้มเข้ามาใหม่ได้เลย";
            tempRoomResults = null;
            tempDealerResult = null;
        }
    } // ปิดตัว else ของเงื่อนไขตรวจเช็กแต้มค้างคัดกรองหลัก
}

// ==================== [ 10. ระบบคู่มือ: คำสั่งสมาชิก (คส), กติกา (กต) และ บัญชี (บช) ] ====================
else if (userMsg === 'คส' || userMsg === 'กต' || userMsg === 'บช' || userMsg === '/บช') {
    if (userMsg === 'คส') {
        replyText = `📜 **[ คู่มือคำสั่งสำหรับสมาชิกทุกท่าน ]** 📜\n\n` +
                    `🔹 **C** ➡️ เช็กเลขสมาชิก ยอดเครดิต และสลิปโพยค้าง + เลขบัญชี\n` +
                    `🔹 **บช** ➡️ ดูเลขบัญชีธนาคารสำหรับเติมเงิน\n` +
                    `🔹 **[เลขขา]-[จำนวนเงิน]** ➡️ ส่งโพยเดิมพัน (เช่น 123-100)\n` +
                    `🔹 **รข-[จำนวนเงิน]** ➡️ แทงเหมาหมดทุกขา ขาละเท่าๆ กัน\n` +
                    `🔹 **รจ-[จำนวนเงิน]** ➡️ แทงเจ้ามือชนผู้เล่นทุกขา ขาละเท่าๆ กัน\n` +
                    `🔹 **R** ➡️ ขอดึงโพยคืน/ยกเลิกโพยทั้งหมดในรอบนั้น (ตอนเปิดแทง)\n` +
                    `🔹 **[เลขขา]+** ➡️ ขอจั่วไพ่ใบที่ 3 เพิ่มเติม (เฉพาะขาผู้เล่นปกติ)\n\n` +
                    `💡 *หมายเหตุ: ทุกคำสั่งสามารถพิมพ์ได้ทั้งตัวพิมพ์เล็กและตัวพิมพ์ใหญ่ครับ*`;
    } 
    else if (userMsg === 'กต') {
        replyText = `💡 สมาชิกพิมพ์ "คส" เพื่อดูวิธีการส่งโพยและคำสั่งอื่นๆ`;
    }
    else if (userMsg === 'บช' || userMsg === '/บช') {
        // 🏦 บล็อกข้อความตอบกลับเรื่องบัญชีธนาคารโดยเฉพาะ
        replyText = `🏦 [ กรุณา พิม ฝากจำนวนเงิน ] 🏦`;
    }
}
                // ==================== [ ระบบดึงโพยและผลไพ่ย้อนหลังรายบุคคล (vรอบ,mสมาชิก) ] ====================
            else if (userMsg.startsWith('v') && userMsg.includes(',m')) {
                // แยกข้อความด้วยเครื่องหมายจุลภาค (,)
                const parts = userMsg.split(',');
                const roundTarget = parseInt(parts[0].replace('v', '')); // ดึงเลขรอบ เช่น v12 -> 12
                const memberTarget = parseInt(parts[1].replace('m', '')); // ดึงเลขสมาชิก เช่น m5 -> 5

                if (isNaN(roundTarget) || isNaN(memberTarget)) {
                    replyText = "⚠️ รูปแบบคำสั่งไม่ถูกต้องครับน้า\nกรุณาพิมพ์ เช่น v12,m5 (เพื่อดูรอบที่ 12 ของสมาชิกคนที่ 5)";
                } else if (!pastRoundsData[roundTarget]) {
                    replyText = `❌ ไม่พบข้อมูลการเล่นของ "รอบที่ ${roundTarget}" ในระบบครับ\n(อาจจะเป็นรอบเก่าก่อนระบบเปิด หรือเซิร์ฟเวอร์เพิ่งรีสตาร์ท)`;
                } else {
                    const historicalRound = pastRoundsData[roundTarget];
                    const historicalDealer = historicalRound.dealer;
                    const historicalRooms = historicalRound.rooms;
                    const historicalBets = historicalRound.bets;

                    // 1. ค้นหาหาชื่อและข้อมูลของสมาชิกคนนี้จากข้อมูลที่บันทึกไว้ในรอบนั้น
                    let targetUid = null;
                    for (let uid in historicalBets) {
                        if (historicalBets[uid][0] && historicalBets[uid][0].memberNumber === memberTarget) {
                            targetUid = uid;
                            break;
                        }
                    }

                    if (!targetUid || !historicalBets[targetUid] || historicalBets[targetUid].length === 0) {
                        replyText = `❌ ไม่พบโพยเดิมพันของ สมาชิกคนที่ ${memberTarget} ในรอบที่ ${roundTarget} ครับ`;
                    } else {
                        const userBets = historicalBets[targetUid];
                        const userName = userBets[0].name;

                        // 2. สร้างหัวข้อรายงานผลไพ่รวมของรอบนั้น
                        let reportText = `🔍 ดึงข้อมูลโพยรายบุคคลย้อนหลัง\n──────────────────\n`;
                        reportText += `🎬 รอบที่: ${roundTarget} \n สมาชิกคนที่ ${memberTarget} (${userName})\n `;
                        reportText += `──────────────────\n`;
                        reportText += `👑 เจ้ามือ: ${historicalDealer.name} (${historicalDealer.mult} เด้ง)\n──────────────────\n`;
                        reportText += `📝 ผลไพ่กระดานรอบที่ ${roundTarget} \n──────────────────\n`;

                        // ลูปพ่นผลไพ่ทั้ง 6 ขาของรอบนั้น
                        for (let leg = 1; leg <= 6; leg++) {
                            if (historicalRooms[leg]) {
                                const res = historicalRooms[leg];
                                let s2 = res.twoCards.score > historicalDealer.score ? "🟢 ชนะ" : (res.twoCards.score < historicalDealer.score ? "🔴 แพ้" : "🟡 เสมอ");
                                let s3 = res.threeCards.score > historicalDealer.score ? "🟢 ชนะ" : (res.threeCards.score < historicalDealer.score ? "🔴 แพ้" : "🟡 เสมor");
                                
                                reportText += `• ขา ${leg}:\n`;
                                reportText += `   - [2ใบ]: ${res.twoCards.name} (${res.twoCards.mult}เด้ง) ${s2}\n`;
                                reportText += `   - [3ใบ]: ${res.threeCards.name} (${res.threeCards.mult}เด้ง) ${s3}\n──────────────────\n`;
                            } else {
                                reportText += `• ขา ${leg} -> ⚠️ ไม่มีผลไพ่ (🔴 แพ้เจ้ามือ)\n`;
                            }
                        }

                        reportText += `📋 โพยรอบนี้ของคุณ \n ${userName} \n──────────────────\n`;

                        let totalWinLoss = 0;
                        let detailRows = "";

                        // 3. เจาะลึกวิเคราะห์โพยและคิดเงินย้อนหลังเพื่อโชว์หลักฐานมัดตัว
                        userBets.forEach((bet) => {
                            let legsToCalc = [];
                            if (bet.betType === "รข" || bet.betType === "รจ") {
                                legsToCalc = ['1', '2', '3', '4', '5', '6'];
                            } else if (bet.betType.startsWith('จ')) {
                                legsToCalc = bet.betType.substring(1).split('');
                            } else {
                                legsToCalc = bet.betType.split('');
                            }

                            // แตกโพยรายบรรทัดส่งโชว์
                            reportText += `- แทงขา [${legsToCalc.join(', ')}] ขาละ ${bet.pricePerLeg} บาท\n`;
                            
                            let drawLegs = [];
                            if (bet.drawStatus) {
                                for (let l in bet.drawStatus) {
                                    if (bet.drawStatus[l] === "จั่ว") drawLegs.push(l);
                                }
                            }
                            if (drawLegs.length > 0) {
                                reportText += `- ขอจั่วเพิ่มขา: [${drawLegs.sort().join(', ')}]\n`;
                            }

                            // คำนวณสรุปรายขาแบบเรียลไทม์เพื่อทำป้ายสรุป
                            legsToCalc.forEach((legStr) => {
                                const legNum = parseInt(legStr);
                                const matchResult = historicalRooms[legNum];
                                if (!matchResult) return;

                                const isBettingOnDealer = (bet.betType === "รจ" || bet.betType.startsWith('จ'));
                                let finalCard;
                                let statusAction = "[อยู่]";

                                if (!isBettingOnDealer) {
                                    const isUserDrawn = (bet.drawStatus && bet.drawStatus[legStr] === "จั่ว");
                                    finalCard = isUserDrawn ? matchResult.threeCards : matchResult.twoCards;
                                    if (isUserDrawn) statusAction = "[จั่ว]";

                                    if (finalCard.score > historicalDealer.score) {
                                        // 🌟 คำนวณหาเพดานค้ำประกันสูงสุดแบบชัวร์ ๆ
    let maxLimit = 3; // ค่าตั้งต้น
    if (bet.maxMultiplier) {
        maxLimit = bet.maxMultiplier;
    } else if (bet.holdCost && bet.actualBet) {
        maxLimit = Math.round(bet.holdCost / bet.actualBet);
    }

    // 🌟 ดักเพดานตัวคูณชนะ ไม่ให้เกินที่ค้ำประกันไว้ในโพย
    let winMultiplier = finalCard.mult;
    if (winMultiplier > maxLimit) {
        winMultiplier = maxLimit;
    }

    let profit = bet.pricePerLeg * winMultiplier;
    totalWinLoss += profit;
    detailRows += `ขาที่ ${legStr} ${statusAction} ชนะ +${profit} (x${winMultiplier})\n`;
} else if (finalCard.score < historicalDealer.score) {
                                        let loseMultiplier = historicalDealer.mult;
                                        if (loseMultiplier > 3) {
                                            loseMultiplier = 3;
                                        }
                                        // 🌟 ดักเพดานตัวคูณแพ้ ไม่ให้เกินที่ค้ำประกันไว้ในโพยเช่นกัน
                                    if (bet.maxMultiplier && loseMultiplier > bet.maxMultiplier) {
                                    loseMultiplier = bet.maxMultiplier;
                                    }
                                        let loss = bet.pricePerLeg * loseMultiplier;
                                        totalWinLoss -= loss;
                                        detailRows += `ขาที่ ${legStr} ${statusAction} แพ้ -${loss}\n`;
                                    } else {
                                        detailRows += `ขาที่ ${legStr} ${statusAction} เสมอ +0\n`;
                                    }
                                } else {
                                    // สำหรับกรณีแทงฝั่งเจ้ามือ
                                    if (matchResult.twoCards.score <= 4 && matchResult.twoCards.mult === 1) {
                                        finalCard = matchResult.threeCards;
                                        statusAction = "[ชน3ใบ]";
                                    } else {
                                        finalCard = matchResult.twoCards;
                                        statusAction = "[ชน2ใบ]";
                                    }

                                    if (historicalDealer.score > finalCard.score) {
    // 🌟 คำนวณหาเพดานค้ำประกันสูงสุดแบบชัวร์ ๆ
    let maxLimit = 3;
    if (bet.maxMultiplier) {
        maxLimit = bet.maxMultiplier;
    } else if (bet.holdCost && bet.actualBet) {
        maxLimit = Math.round(bet.holdCost / bet.actualBet);
    }

    let dealerWinMult = historicalDealer.mult;
    if (dealerWinMult > maxLimit) {
        dealerWinMult = maxLimit;
    }

    let grossWin = bet.pricePerLeg * dealerWinMult;
    let netWin = Math.floor(grossWin * 0.9);
    totalWinLoss += netWin;
    detailRows += `ขาที่ ${legStr} ${statusAction} เจ้าชนะ +${netWin} (หักต๋งแล้ว) (x${dealerWinMult})\n`;
} else if (historicalDealer.score < finalCard.score) {
    // 🌟 คำนวณหาเพดานค้ำประกันสูงสุดแบบชัวร์ ๆ
    let maxLimit = 3;
    if (bet.maxMultiplier) {
        maxLimit = bet.maxMultiplier;
    } else if (bet.holdCost && bet.actualBet) {
        maxLimit = Math.round(bet.holdCost / bet.actualBet);
    }

    let dealerLoseMult = finalCard.mult;
    if (dealerLoseMult > maxLimit) {
        dealerLoseMult = maxLimit;
    }

    let loss = bet.pricePerLeg * dealerLoseMult;
    totalWinLoss -= loss;
    detailRows += `ขาที่ ${legStr} ${statusAction} เจ้าแพ้ -${loss} (x${dealerLoseMult})\n`;
} else {
    detailRows += `ขาที่ ${legStr} ${statusAction} เสมอ +0\n`;
}
                                }
                            });
                        });

                        // 4. ประกอบร่างข้อความสรุปท้ายกระดาษ
                        let signStr = totalWinLoss > 0 ? `กำไร +${totalWinLoss}` : (totalWinLoss < 0 ? `ขาดทุน ${totalWinLoss}` : `เสมอตัว +0`);
                        reportText += `──────────────────\n📊 สรุปดีเทลการเล่น \n──────────────────\n${detailRows}`;
                        reportText += `──────────────────\n👉 ยอดกำไร/ขาดทุนในรอบนี้: ${signStr} บาท`;                   

                        replyText = reportText;
                    }
                }
            }
               
                // ==================== [ ระบบสมาชิกแจ้งถอนเงิน - รูปแบบพิมติดกัน (ถอน500) ] ====================
            else if (userMsg.startsWith('ถอน')) {
                const user = usersWallets[userId];
                
                if (!user) {
                    replyText = "⚠️ คุณยังไม่ได้ลงทะเบียนสมาชิกในระบบครับ";
                } 
                else if (user.isWithdrawLocked) {
                    replyText = `❌ ไม่สามารถทำรายการซ้ำได้ครับ!\n👤 คุณ ${user.name} 有รายการแจ้งถอนค้างอยู่จำนวน ${user.pendingWithdrawAmount} บาท อยู่ในระหว่างรอแอดมินอนุมัติครับ`;
                } 
                else if (user.turnoverTarget > 0) {
                    replyText = `❌ ไม่สามารถแจ้งถอนเงินได้ครับน้า!\n👤 คุณ: ${user.name} (ID: ${user.memberNumber})\n\n🚨 เนื่องจากคุณเลือกรับโบนัสและยังทำยอดเทิร์นไม่ครบ\n📉 ยอดเทิร์นคงค้างที่ต้องเล่นเพิ่มอีก: ${user.turnoverTarget} บาท จึงจะถอนเงินได้ครับ`;
                }
                else {
                    // 🔍 ดึงตัวเลขทั้งหมดที่ต่อท้ายคำว่า "ถอน" ออกมาโดยตรง (พิมพ์ ถอน500 หรือ ถอน 500 ก็ดึงได้หมด)
                    const withdrawAmount = parseInt(userMsg.replace('ถอน', '').trim());

                    if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
                        replyText = "⚠️ รูปแบบคำสั่งไม่ถูกต้องครับ กรุณาพิมพ์ระบุจำนวนเงิน เช่น ถอน500";
                    } else if (user.balance < withdrawAmount) {
                        replyText = `❌ แจ้งถอนล้มเหลว: ยอดเครดิตของคุณมีไม่เพียงพอครับ (เครดิตปัจจุบัน: ${user.balance} บาท)`;
                    } else {
                        // 🔒 สั่งล็อกสถานะบัญชี และจำยอดเงินที่ต้องการถอนไว้ (ยังไม่หักเครดิตจริง)
                        user.isWithdrawLocked = true;
                        user.pendingWithdrawAmount = withdrawAmount;

                        // 💡 เพิ่มเข้าคิวถอนเงิน
                        withdrawQueue.push({ 
                            memberNumber: user.memberNumber, 
                            name: user.name, 
                            amount: withdrawAmount, 
                            time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) 
                        });
                        
                        await saveDataToFirebase(); // เซฟถาวรลง Firebase

                       // 🔔 [อัปเดตขั้นสุด] ดึงข้อมูลธนาคาร เลขบัญชี และเครดิตสุทธิคงเหลือในระบบขึ้นโชว์ในการ์ดแอดมิน
                        const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db"; // ไอดีไลน์ส่วนตัวของน้า
                        
                        const adminWithdrawAlertFlex = {
                            "type": "flex",
                            "altText": `🚨 แจ้งถอนใหม่! คุณ ${user.name} ยอด ${withdrawAmount} บาท`,
                            "contents": {
                                "type": "bubble",
                                "styles": {
                                    "header": { "backgroundColor": "#141416" },
                                    "body": { "backgroundColor": "#1e1e22" },
                                    "footer": { "backgroundColor": "#141416" }
                                },
                                "header": {
                                    "type": "box",
                                    "layout": "vertical",
                                    "contents": [
                                        { "type": "text", "text": "🚨 มีรายการแจ้งถอนเงินใหม่!", "weight": "bold", "color": "#ff3b47", "size": "md", "align": "center" }
                                    ]
                                },
                                "body": {
                                    "type": "box",
                                    "layout": "vertical",
                                    "spacing": "sm",
                                    "contents": [
                                        {
                                            "type": "box",
                                            "layout": "horizontal",
                                            "contents": [
                                                { "type": "text", "text": "🆔 สมาชิกเด่น:", "size": "sm", "color": "#8e8e93" },
                                                { "type": "text", "text": `ลำดับที่ ${user.memberNumber}`, "size": "sm", "color": "#ffffff", "weight": "bold", "align": "end" }
                                            ]
                                        },
                                        {
                                            "type": "box",
                                            "layout": "horizontal",
                                            "contents": [
                                                { "type": "text", "text": "👤 ชื่อลูกค้า:", "size": "sm", "color": "#8e8e93" },
                                                { "type": "text", "text": `คุณ ${user.name}`, "size": "sm", "color": "#ffffff", "weight": "bold", "align": "end" }
                                            ]
                                        },
                                        {
                                            "type": "box",
                                            "layout": "horizontal",
                                            "contents": [
                                                { "type": "text", "text": "🏦 ธนาคาร:", "size": "sm", "color": "#8e8e93" },
                                                { "type": "text", "text": `${user.bankName || "ไม่ได้ระบุ"}`, "size": "sm", "color": "#ffffff", "weight": "bold", "align": "end" }
                                            ]
                                        },
                                        {
                                            "type": "box",
                                            "layout": "horizontal",
                                            "contents": [
                                                { "type": "text", "text": "💳 เลขบัญชี:", "size": "sm", "color": "#8e8e93" },
                                                { "type": "text", "text": `${user.bankAccount || "ไม่ได้ระบุ"}`, "size": "sm", "color": "#00bfff", "weight": "bold", "align": "end" }
                                            ]
                                        },
                                        { "type": "separator", "margin": "xs", "color": "#3a3a3c" },
                                        {
                                            "type": "box",
                                            "layout": "horizontal",
                                            "contents": [
                                                { "type": "text", "text": "💰 เงินรวมในระบบ:", "size": "sm", "color": "#ffaa00", "weight": "bold" },
                                                { "type": "text", "text": `${user.balance.toLocaleString()} บาท`, "size": "sm", "color": "#ffaa00", "weight": "bold", "align": "end" }
                                            ]
                                        },
                                        {
                                            "type": "box",
                                            "layout": "horizontal",
                                            "contents": [
                                                { "type": "text", "text": "💸 ยอดที่แจ้งถอน:", "size": "sm", "color": "#ffffff", "weight": "bold" },
                                                { "type": "text", "text": `${withdrawAmount.toLocaleString()} บาท`, "size": "md", "color": "#ff3b47", "weight": "bold", "align": "end" }
                                            ]
                                        },
                                        { "type": "separator", "margin": "xs", "color": "#3a3a3c" },
                                        { "type": "text", "text": "💡 ตรวจสอบยอด 'เงินรวมในระบบ' เทียบกับ 'ยอดที่แจ้งถอน' ให้เรียบร้อยก่อนกดอนุมัตินะครับน้า", "color": "#aaaaaa", "size": "xs", "wrap": true, "margin": "sm" }
                                    ]
                                },
                                "footer": {
                                    "type": "box",
                                    "layout": "vertical",
                                    "spacing": "sm",
                                    "contents": [
                                        {
                                            "type": "button",
                                            "style": "primary",
                                            "color": "#00aa5b",
                                            "height": "sm",
                                            "action": {
                                                "type": "message",
                                                "label": "✅ อนุมัติโอนเงินสำเร็จ (y)",
                                                "text": `y ${user.memberNumber}`
                                            }
                                        }
                                    ]
                                }
                            }
                        };

                        // ยิงการ์ดตรงเข้าแชทส่วนตัวแอดมิน
                        try {
                            await axios.post('https://api.line.me/v2/bot/message/push', {
                                to: ADMIN_ID,
                                messages: [adminWithdrawAlertFlex]
                            }, {
                                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` }
                            });
                            console.log("✅ ส่งการ์ดแจ้งถอนเข้าแอดมินเรียบร้อยแล้ว");
                        } catch (err) {
                            console.error("❌ ส่งแจ้งถอนเข้าแชทส่วนตัวแอดมินล้มเหลว:", err.message);
                        }

                        // 🏆 ประกอบร่างกล่อง Flex Message แจ้งถอนเงิน สีดำ-ทอง วิ่งตรงเข้าตัวแปร Global
                        global.currentReplyFlex = {
                            type: "flex",
                            altText: "⏳ ระบบรับเรื่องแจ้งถอนเงินสำเร็จ",
                            contents: {
                                type: "bubble",
                                styles: {
                                    header: { backgroundColor: "#141416" },
                                    body: { backgroundColor: "#1e1e22" }
                                },
                                header: {
                                    type: "box",
                                    layout: "vertical",
                                    contents: [
                                        {
                                            type: "text",
                                            text: "⏳ ระบบรับเรื่องแจ้งถอนเงิน",
                                            weight: "bold",
                                            color: "#d4af37",
                                            size: "sm"
                                        }
                                    ]
                                },
                                body: {
                                    type: "box",
                                    layout: "vertical",
                                    contents: [
                                        {
                                            type: "box",
                                            layout: "horizontal",
                                            contents: [
                                                { type: "text", text: "👤 ชื่อลูกค้า", color: "#8e8e93", size: "xs" },
                                                { type: "text", text: `${user.name} (ID: ${user.memberNumber})`, color: "#ffffff", size: "xs", align: "end", weight: "bold" }
                                            ]
                                        },
                                        {
                                            type: "box",
                                            layout: "horizontal",
                                            margin: "sm",
                                            contents: [
                                                { type: "text", text: "💰 ยอดที่แจ้งถอน", color: "#ffffff", size: "sm", weight: "bold" },
                                                { type: "text", text: `${withdrawAmount.toLocaleString()} บาท`, color: "#e53e3e", size: "md", align: "end", weight: "bold" }
                                            ]
                                        },
                                        { type: "separator", margin: "md", color: "#3a3a3c" },
                                        {
                                            type: "text",
                                            text: "⚠️ สถานะบัญชี: ถูกล็อกชั่วคราว! ระหว่างนี้จะไม่สามารถส่งโพยแทง หรือแจ้งถอนซ้ำได้ จนกว่าแอดมินจะกดยืนยันยอดโอนสำเร็จครับ",
                                            color: "#aaaaaa",
                                            size: "xxs",
                                            margin: "md",
                                            wrap: true
                                        },
                                        { type: "separator", margin: "md", color: "#3a3a3c" },
                                        {
                                            type: "box",
                                            layout: "vertical",
                                            margin: "md",
                                            contents: [
                                                { type: "text", text: "📢 สำหรับแอดมินอนุมัติ", color: "#d4af37", size: "xxs", weight: "bold" },
                                                { type: "text", text: `กรุณาตรวจสอบยอดโอน และพิมพ์คำสั่งนี้เพื่ออนุมัติ:\ny ${user.memberNumber}`, color: "#ffffff", size: "xs", margin: "xs", weight: "bold", wrap: true }
                                            ]
                                        }
                                    ]
                                }
                            }
                        };
                    }
                }
            }
                // ==================== [ ระบบแอดมินอนุมัติการถอนเงิน (y เลขสมาชิก แบบคนเดียว หรือ หลายคนพร้อมกัน) ] ====================
else if (command.toLowerCase() === "y") {
    if (!ADMIN_IDS.includes(userId)) {
    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
} else {
        // 🎯 ดึงเลขสมาชิกทั้งหมดจากตัวแปร args (เช่น พิมพ์ "y 1 2" -> args จะได้ ['1', '2'])
        // แต่ถ้าแอดมินพิมพ์แค่ "y" ลอยๆ args ตัวแรกสุด (args[0]) อาจจะเป็นคำว่า y ให้ข้ามไปเอาตัวถัดไป
        let targetMemberIds = args.map(id => parseInt(id)).filter(id => !isNaN(id));
        
        // ถ้าพิมพ์ y 1 แล้ว args ดึงมาได้เลขเลย ให้ใช้ได้เลย แต่ถ้าไม่มีเลข ลองแกะจากข้อความเต็ม (userMsg) เผื่อไว้
        if (targetMemberIds.length === 0) {
            targetMemberIds = userMsg.replace(/y|Y/, '').trim().split(/\s+/).map(id => parseInt(id)).filter(id => !isNaN(id));
        }

        if (targetMemberIds.length === 0) {
            replyText = "⚠️ รูปแบบคำสั่งไม่ถูกต้อง กรุณาพิมพ์: y ตามด้วยเลขสมาชิก\n(ตัวอย่างเช่น: Y 1 หรือโอนพร้อมกันหลายคนพิมพ์: Y 1 2 3)";
        } else {
            let successReports = [];
            let errorReports = [];

            // วนลูปประมวลผลเลขสมาชิกทุกคนที่ส่งมาพร้อมกัน
            for (let targetMemberId of targetMemberIds) {
                let foundUserKey = null;
                for (let key in usersWallets) {
                    if (usersWallets[key].memberNumber === targetMemberId) {
                        foundUserKey = key;
                        break;
                    }
                }

                if (!foundUserKey) {
                    errorReports.push(`❌ ไม่พบเลขสมาชิกที่ ${targetMemberId} ในระบบครับ`);
                } else {
                    const user = usersWallets[foundUserKey];
                    
                    if (!user.isWithdrawLocked) {
                        errorReports.push(`⚠️ สมาชิก ID: ${targetMemberId} คุณ ${user.name} ไม่ได้มียอดแจ้งถอนค้างไว้ครับ`);
                    } else {
                        const finalAmount = user.pendingWithdrawAmount;
                        
                        // ✅ 1. ทำการหักเงินเครดิตจริงออกจากกระเป๋า
                        user.balance -= finalAmount;
                        
                        
                        // 🔓 2. ทำการปลดล็อกบัญชีให้ส่งโพยใหม่ได้ตามปกติ
                        user.isWithdrawLocked = false;
                        user.pendingWithdrawAmount = 0;

                        // 🗑️ 3. ลบสมาชิกคนนี้ออกจากคิวรอถอน (withdrawQueue) ทันที ยอดใน "ชถ" จะหายไป
                        if (typeof withdrawQueue !== 'undefined') {
                            withdrawQueue = withdrawQueue.filter(item => item.memberNumber !== targetMemberId);
                        }

                        // เก็บข้อความสำเร็จของแต่ละคนไว้ประกอบร่างตอนท้าย
                        successReports.push(
                            `👤 คุณ: ${user.name} (ID: ${user.memberNumber})\n` +
                            `💸 หักเครดิตเรียบร้อย: -${finalAmount} บาท\n` +
                            `💰 ยอดเครดิตคงเหลือ: ${user.balance} บาท\n` +
                            `🔓 สถานะบัญชี: ปลดล็อกเรียบร้อย`
                        );
                    }
                }
            }
            // 💾 4. บันทึกลง Firebase (ปลอดภัยด้วย try...catch เพื่อไม่ให้บอทเงียบ)
            if (successReports.length > 0) {
                try {
                    // เซฟกระเป๋าเงินและข้อมูลหลัก
                    await saveDataToFirebase(); 

                    // จัดการเคลียร์ node withdrawQueue บน Firebase
                    if (typeof withdrawQueue !== 'undefined') {
                        if (withdrawQueue.length === 0) {
                            // ถ้ามี db ให้ลบ node ทิ้ง ถ้าไม่มีก็ข้ามไปไม่ให้ crash
                            if (typeof db !== 'undefined') {
                                await db.ref('withdrawQueue').remove().catch(e => console.log(e));
                            }
                        } else {
                            if (typeof db !== 'undefined') {
                                await db.ref('withdrawQueue').set(withdrawQueue).catch(e => console.log(e));
                            }
                        }
                    }
                } catch (err) {
                    console.error("Firebase Sync Error (แต่ระบบหักเงินทำงานแล้ว):", err);
                }
            }

            // --- จัดรูปแบบข้อความแสดงผลลัพธ์ให้สวยงาม ---
            let finalReply = "";
            if (successReports.length > 0) {
                finalReply += `✅ [อนุมัติถอนเงินสำเร็จ] 🎉\n──────────────────\n` + successReports.join('\n──────────────────\n');
            }
            if (errorReports.length > 0) {
                if (finalReply !== "") finalReply += `\n\n──────────────────\n🚨 รายงานข้อผิดพลาด:\n`;
                finalReply += errorReports.join('\n');
            }

            // แสดงยอดคงค้างในคิวปัจจุบันพ่วงท้าย
            const queueCount = typeof withdrawQueue !== 'undefined' ? withdrawQueue.length : 0;
            finalReply += `\n──────────────────\n📊 คงเหลือในคิวรอถอน: ${queueCount} รายการ (พิมพ์ "ชถ" เพื่อดูคิวปัจจุบัน)`;

            replyText = finalReply;
        }
    }
}
                // ==================== [ ระบบแอดมินเรียกดูรายงานผลและโพยย้อนหลัง (v เลขรอบ) ] ====================
            else if (command.toLowerCase() === "v") {
                if (!ADMIN_IDS.includes(userId)) {
    replyText = "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ";
} else {
                    const targetRound = parseInt(args[1]);

                    if (!targetRound || isNaN(targetRound)) {
                        replyText = "⚠️ รูปแบบคำสั่งไม่ถูกต้อง กรุณาพิมพ์: v [เลขรอบ] หรือ V [เลขรอบ] (ตัวอย่างเช่น: V 5)";
                    } else {
                        // ค้นหาข้อความรายงานในคลังประวัติ
                        const savedReport = detailedRoundHistory[targetRound];

                        if (!savedReport) {
                            replyText = `❌ ไม่พบข้อมูลบันทึกสรุปผลของ "รอบที่ ${targetRound}" ในระบบครับ (ระบบจะจำข้อมูลตั้งแต่เปิดเซิร์ฟเวอร์ล่าสุดครับ)`;
                        } else {
                            // 📄 ดีดรายงานสรุปยอดโชว์ใหม่อีกครั้ง
                            replyText = `📋 **[ ค้นพบข้อมูลย้อนหลัง ]** 📋\n` +
                                        `🔍 แอดมินเรียกดูประวัติเก่าของ รอบที่: ${targetRound}\n` +
                                        `──────────────────\n\n` + 
                                        savedReport;
                        }
                    }
                }
            }
         // ==================== [ 7. ระบบลงทะเบียน / เช็กบัตรสมาชิก ] ====================
            else {
                const isRegistered = usersWallets[userId] ? true : false;

                if (!isRegistered) {
                    if (originalMsg.startsWith('C/') || originalMsg.startsWith('c/')) {
                        const registerCode = originalMsg.substring(2).trim(); // ดึงเฉพาะตัวเลขหลัง c/
                        const pendingCodeKey = `c_${registerCode}`; // แปลงเป็น c_748100

                        try {
                            // 🔍 ดึงข้อมูลจาก Firebase โดยใช้ axios (REST API)
                            const resData = await axios.get(`${FIREBASE_URL}pending_verify/${pendingCodeKey}.json`);
                            const webData = resData.data;

                            // ❌ กรณีที่ไม่พบรหัสโค้ดใน Firebase (webData เป็น null)
                            if (!webData) {
                                await axios.post('https://api.line.me/v2/bot/message/reply', {
                                    replyToken: replyToken,
                                    messages: [{
                                        "type": "text",
                                        "text": `❌ ไม่พบรหัสยืนยัน [ C/${registerCode} ] ในระบบ\nรหัสนี้อาจถูกใช้งานไปแล้ว หรือคุณกรอกรหัสไม่ถูกต้องครับ`
                                    }]
                                }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` } });
                                return res.sendStatus(200);
                            }

                            // 🟢 ดึงข้อมูลจาก Firebase
                            const fullName = webData.name || webData.fullName || "";
                            const nickname = webData.nickname || webData.lineName || fullName || "สมาชิก";
                            const bankName = webData.bankName || "";
                            const bankAccount = webData.bankAccount || webData.accountNumber || "";

                            // 💾 บันทึกข้อมูลลงกระเป๋าเงิน (usersWallets)
                            usersWallets[userId] = {
                                memberNumber: nextMemberId,
                                name: fullName,
                                nickname: nickname,
                                balance: 0, 
                                turnoverTarget: 0,
                                turnoverCount: 0,
                                isWithdrawLocked: false,
                                pendingWithdrawAmount: 0,
                                bankName: bankName,
                                bankAccount: bankAccount
                            };

                            // 🧹 ลบโค้ดนี้ออกจาก pending_verify ใน Firebase
                            await axios.delete(`${FIREBASE_URL}pending_verify/${pendingCodeKey}.json`);

                            // ==================== [ 🚀 ยิง Flex Message แจ้งสมัครสมาชิกสำเร็จ ] ====================
                            await axios.post('https://api.line.me/v2/bot/message/reply', {
                                replyToken: replyToken,
                                messages: [
                                    {
                                        "type": "flex",
                                        "altText": "🎉 ลงทะเบียนสมาชิกใหม่สำเร็จ! 🎉",
                                        "contents": {
                                            "type": "bubble",
                                            "styles": { "body": { "backgroundColor": "#0c1921" } },
                                            "body": {
                                                "type": "box",
                                                "layout": "vertical",
                                                "spacing": "md",
                                                "contents": [
                                                    { "type": "text", "text": "🎉 ลงทะเบียนสมาชิกใหม่สำเร็จ! 🎉", "weight": "bold", "color": "#00ffcc", "size": "md", "align": "center" },
                                                    { "type": "separator", "color": "#183242" },
                                                    {
                                                        "type": "box",
                                                        "layout": "vertical",
                                                        "spacing": "xs",
                                                        "contents": [
                                                            {
                                                                "type": "box", "layout": "horizontal", "contents": [
                                                                    { "type": "text", "text": "🆔 รหัสสมาชิก:", "size": "xs", "color": "#8ab4cd" },
                                                                    { "type": "text", "text": `${nextMemberId}`, "size": "xs", "color": "#ffffff", "align": "end", "weight": "bold" }
                                                                ]
                                                            },
                                                            {
                                                                "type": "box", "layout": "horizontal", "contents": [
                                                                    { "type": "text", "text": "👤 ชื่อ-นามสกุล:", "size": "xs", "color": "#8ab4cd" },
                                                                    { "type": "text", "text": `${fullName}`, "size": "xs", "color": "#ffffff", "align": "end" }
                                                                ]
                                                            },
                                                            {
                                                                "type": "box", "layout": "horizontal", "contents": [
                                                                    { "type": "text", "text": "🏦 ธนาคาร:", "size": "xs", "color": "#8ab4cd" },
                                                                    { "type": "text", "text": `${bankName}`, "size": "xs", "color": "#ffffff", "align": "end" }
                                                                ]
                                                            },
                                                            {
                                                                "type": "box", "layout": "horizontal", "contents": [
                                                                    { "type": "text", "text": "💰 ยอดคงเหลือ:", "size": "xs", "color": "#8ab4cd" },
                                                                    { "type": "text", "text": "0 บาท", "size": "xs", "color": "#00ff66", "align": "end", "weight": "bold" }
                                                                ]
                                                            }
                                                        ]
                                                    },
                                                    { "type": "separator", "color": "#183242" },
                                                    { "type": "text", "text": "🔒 ข้อมูลบัญชีธนาคารบันทึกเข้าคลังหลังบ้านปลอดภัย ไม่แสดงหน้ากลุ่มค่ะ", "size": "10px", "color": "#a2c1d4", "wrap": true },
                                                    { "type": "separator", "color": "#183242" },
                                                    { "type": "text", "text": "💡 ตอนนี้คุณสามารถส่งโพย หรือ ฝากเครดิตพิมพ์ [ฝาก จำนวนเงิน] ได้เลย", "size": "xs", "color": "#00ffcc", "wrap": true, "style": "italic" }
                                                ]
                                            }
                                        }
                                    }
                                ]
                            }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` } });

                            nextMemberId++;
                            await saveDataToFirebase();
                            return res.sendStatus(200);

                        } catch (err) {
                            console.error("Error in c/ register process:", err);
                            return res.sendStatus(200);
                        }

                    } else {
                        // ==================== [ 📢 Flex Message แจ้งเตือนคนยังไม่สมัคร ] ====================
                        try {
                            await axios.post('https://api.line.me/v2/bot/message/reply', {
                                replyToken: replyToken,
                                messages: [
                                    {
                                        "type": "flex",
                                        "altText": "📢 ยินดีต้อนรับครับสมาชิกใหม่ กรุณาลงทะเบียน",
                                        "contents": {
                                            "type": "bubble",
                                            "styles": { "body": { "backgroundColor": "#0d161b" } },
                                            "body": {
                                                "type": "box",
                                                "layout": "vertical",
                                                "spacing": "md",
                                                "contents": [
                                                    { "type": "text", "text": "📢 ยินดีต้อนรับครับสมาชิกใหม่ 🤝", "weight": "bold", "color": "#00ffcc", "size": "md", "align": "center" },
                                                    { "type": "separator", "color": "#1d2d35" },
                                                    { "type": "text", "text": "⚠️ คุณยังไม่ได้ลงทะเบียนในระบบ", "size": "xs", "color": "#ffcc00", "align": "center", "weight": "bold" },
                                                    { "type": "separator", "color": "#1d2d35" },
                                                    { "type": "text", "text": "กรุณาลงทะเบียนผ่านเว็บสมัครสมาชิก จากนั้นคัดลอกรหัส (เช่น C/748100) มาวางในกลุ่มนี้เพื่อเปิดใช้งานครับ", "size": "xs", "color": "#cccccc", "wrap": true },
                                                    { "type": "separator", "color": "#1d2d35" },
                                                    { "type": "text", "text": "📌 ตัวอย่างการยืนยัน: C/748100", "size": "xs", "color": "#00ffcc", "align": "center", "weight": "bold" }
                                                ]
                                            }
                                        }
                                    }
                                ]
                            }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` } });
                        } catch (err) { console.error("Error sending alert non-registered flex:", err); }
                        return res.sendStatus(200);
                    }
                } else {
                    // 🟢 กรณีที่เป็นสมาชิกเก่าที่ลงทะเบียนเรียบร้อยแล้ว
                    const user = usersWallets[userId];
                    
                   // ==================== [ คำสั่งเช็กยอด c เวอร์ชันการ์ดดำทอง ] ====================
                    if (userMsg === 'c') {
                        // 🛡️ 1. ระบบ Anti-Spam กันสมาชิกกด c ย้ำๆ (ตั้งไว้ที่ 3 วินาทีต่อคน)
    if (!global.cCooldowns) global.cCooldowns = new Map();
    const now = Date.now();
    const lastUsed = global.cCooldowns.get(userId) || 0;
    const cooldownTime = 1500; // 1500 ms = 1.5 วินาที

    if (now - lastUsed < cooldownTime) {
        // ถ้าพิมพ์รัวเกิน 1.5 วินาที ให้ข้าม ไม่ต้องส่ง Flex Message ซ้ำเพื่อเซฟโควต้า LINE
        replyText = null;
        return; 
    }
    global.cCooldowns.set(userId, now);
                        
                        // 🛠️ แก้ปัญหา LINE API บล็อกข้อความว่าง: บังคับให้ข้อความธรรมดาเป็น null เพื่อส่งแค่การ์ด Flex
                        replyText = null;

                        // 📝 1. ดึงรายการโพยของจริงจากระบบมาจัดแถวตัวหนังสือย่อยในการ์ด
                        let betContents = [];
                        const myBets = roundBets[userId] || [];
                        
                        if (myBets && myBets.length > 0) {
                            myBets.forEach((bet, index) => {
                                let betText = `${index + 1}. ${bet.detail}`;
                                if (bet.drawStatus) {
                                    let drawLegs = [];
                                    for (let leg in bet.drawStatus) {
                                        if (bet.drawStatus[leg] === "จั่ว") drawLegs.push(leg);
                                    }
                                    if (drawLegs.length > 0) {
                                        betText += ` 🃏 (จั่ว: ${drawLegs.sort().join(', ')})`;
                                    }
                                }
                                betContents.push({
                                    type: "text",
                                    text: betText,
                                    color: "#e0e0e0",
                                    size: "xs",
                                    wrap: true,
                                    margin: "xs"
                                });
                            });
                            
                            const totalHold = myBets.reduce((sum, bet) => sum + (bet.holdCost || 0), 0);
                            betContents.push({
                                type: "text",
                                text: `🔒 ประกันเด้งที่ล็อก: ${totalHold} บาท`,
                                color: "#ffaa00",
                                size: "xs",
                                weight: "bold",
                                margin: "sm"
                            });
                        } else {
                            betContents.push({
                                type: "text",
                                text: "ไม่มีโพยค้างในรอบนี้",
                                color: "#888888",
                                size: "xs",
                                style: "italic"
                            });
                        }

                        // 👑 2. เช็กสถานะเทิร์นโอเวอร์
                        let turnStatusText = "🔓 ปกติ (ไม่ติดเทิร์น)";
                        let turnStatusColor = "#55ff55";
                        if (user.turnoverTarget && user.turnoverTarget > 0) {
                            turnStatusText = `🔒ติดเทิร์น (เป้า:${user.turnoverTarget} บ.)`;
                            turnStatusColor = "#ff5555";
                        }

                       // 🏆 3. ประกอบร่างกล่อง Flex Message สีดำ-ทอง วิ่งตรงเข้าตัวแปร Global
                        global.currentReplyFlex = {
                            type: "flex",
                            altText: "📊 บัตรข้อมูลสมาชิกและยอดเงินของคุณ",
                            contents: {
                                type: "bubble",
                                styles: {
                                    header: { backgroundColor: "#141416" },
                                    body: { backgroundColor: "#1e1e22" }
                                },
                               header: {
                type: "box",
                layout: "vertical",
                contents: [
                    {
                        type: "text",
                        text: "👑 การ์ดข้อมูลสมาชิก",
                        weight: "bold",
                        color: "#d4af37",
                        size: "sm"
                    }
                ]
            },
            body: {
                type: "box",
                layout: "vertical",
                contents: [
                    {
                        type: "box",
                        layout: "horizontal",
                        contents: [
                            { type: "text", text: "👤 สมาชิกคนที่", color: "#8e8e93", size: "xs" },
                            { type: "text", text: `No. ${user.memberNumber}`, color: "#ffffff", size: "xs", align: "end", weight: "bold" }
                        ]
                    },
                    {
                        type: "box",
                        layout: "horizontal",
                        margin: "sm",
                        contents: [
                            { type: "text", text: "🏷️ ชื่อLine", color: "#8e8e93", size: "xs" },
                            { type: "text", text: `${user.nickname || user.name}`, color: "#00ffcc", size: "xs", align: "end", weight: "bold" } // 👈 ปรับโชว์เฉพาะชื่อเล่น
                        ]
                    },
                    { type: "separator", margin: "md", color: "#3a3a3c" },
                    {
                        type: "box",
                        layout: "horizontal",
                        margin: "md",
                        contents: [
                            { type: "text", text: "💵 เครดิตกระเป๋า", color: "#ffffff", size: "sm", weight: "bold" },
                            { type: "text", text: `${user.balance.toLocaleString()} บาท`, color: "#d4af37", size: "md", align: "end", weight: "bold" }
                        ]
                    },
                    {
                        type: "box",
                        layout: "horizontal",
                        margin: "sm",
                        contents: [
                            { type: "text", text: "📊 สถานะเทิร์น", color: "#8e8e93", size: "xs", flex: 4 },
                            { type: "text", text: turnStatusText, color: turnStatusColor, size: "xs", align: "end", weight: "bold", flex: 6 }
                        ]
                    },
                    { type: "separator", margin: "md", color: "#3a3a3c" },
                    {
                        type: "box",
                        layout: "vertical",
                        margin: "md",
                        contents: [
                            { type: "text", text: "📝 รายการโพยรอบนี้:", color: "#d4af37", size: "xs", weight: "bold", margin: "xs" },
                            {
                                type: "box",
                                layout: "vertical",
                                margin: "xs",
                                contents: betContents
                            }
                        ]
                    },
                    { type: "separator", margin: "md", color: "#3a3a3c" },
                    {
                        type: "box",
                        layout: "vertical",
                        margin: "md",
                        contents: [
                            { type: "text", text: "📖 คู่มือช่วยเหลือใช้งาน", color: "#8e8e93", size: "xxs", weight: "bold" },
                            { type: "text", text: "• พิมพ์ คส เพื่อดูคำสั่งทั้งหมด\n• พิมพ์ ฝาก [จำนวน] หรือ ถอน [จำนวน]\n• พิมพ์ กต เพื่ออ่านกฎกติกาห้อง", color: "#aaaaaa", size: "xxs", margin: "xs", wrap: true }
                        ]
                    }
                ]
            }
        }
    };
} else if (originalMsg.startsWith('C/') || originalMsg.startsWith('c/')) {
                        // 🔒 ป้องกันคนเก่าแอบพิมพ์ C/ มาเปลี่ยนชื่อหลังบ้าน
                        replyText = `❌ ไม่สามารถเปลี่ยนข้อมูลเองได้ค่ะคุณ ${user.name}!\n──────────────────\n⚠️ เนื่องจากระบบได้ผูกบัญชีธนาคารของคุณไว้ในคลังความปลอดภัยแล้ว\n\n📌 หากต้องการเปลี่ยน ชื่อ-นามสกุล หรือ เลขบัญชีธนาคาร กรุณาทักแชทติดต่อแอดมินโดยตรงเพื่อขออัปเดตข้อมูลนะคะ 🙏`;
                    } else {
                        // ปล่อยว่างไว้เพื่อให้ข้อความทั่วไปไหลไปเข้า Settlement / แทงโพย ปกติตามธรรมชาติ
                        replyText = "";
                    }
                }
            } // ปิดระบบลงทะเบียน
            
            // ==================== [ แก้ไขบั๊ก m 1 2: คำสั่ง m เช็กบัญชีแยกรายคนด้วยเว้นวรรคอย่างแม่นยำ ] ====================
            if (userMsg.startsWith('m') && !userMsg.includes('-') && !userMsg.endsWith('+') && userMsg !== 'รข' && userMsg !== 'รจ') {
                // 🚨 กรองขั้นสูงสุด: ถ้าไม่ใช่แอดมินในกล่องกลาง หรือ แอดมินไม่ได้สั่งในแชทส่วนตัว (1 ต่อ 1) ให้บอทเงียบกริบไม่ตอบ
                if (!ADMIN_IDS.includes(userId) || event.source.type !== 'user') {
                    return res.sendStatus(200);
                }

                const args = userMsg.split(/\s+/);

                // 🛠️ แก้ไขจุดนี้: ดึงข้อความดิบทั้งหมดที่ต่อจากตัว m (เก็บเว้นวรรคเอาไว้ตัดแบ่ง)
                const rawData = originalMsg.substring(1).trim(); 
                
                // ตัดแบ่งข้อความด้วยช่องว่าง (เว้นวรรคกี่ช่องก็ได้) เพื่อแยกเป็นอาร์เรย์ตัวเลขเด็ดขาด
                const memberIds = rawData.split(/\s+/).map(id => parseInt(id)).filter(id => !isNaN(id));

                if (memberIds.length === 0) {
                    replyText = "⚠️ รูปแบบคำสั่งไม่ถูกต้องครับน้า กรุณาระบุเลขสมาชิกด้วยครับ เช่น m1 หรือ m 1 2 3";
                } else {
                    let totalReport = ""; // ตัวแปรสำหรับรวบรวมรายงานของทุกคน

                    // วนลูปตรวจสอบข้อมูลตามรายชื่อเลขสมาชิกที่ส่งเข้ามา
                    memberIds.forEach((targetMemberId, index) => {
                        let foundUser = null;
                        for (let id in usersWallets) {
                            if (usersWallets[id].memberNumber === targetMemberId) {
                                foundUser = usersWallets[id];
                                break;
                            }
                        }

                        // ถ้าตรวจสอบแล้วเจอข้อมูลสมาชิกในระบบ
                        if (foundUser) {
                            let withdrawStatusText = "🟢 ไม่มีการแจ้งถอน";
                            if (foundUser.isWithdrawLocked && foundUser.pendingWithdrawAmount > 0) {
                                withdrawStatusText = `🚨 แจ้งถอน: ${foundUser.pendingWithdrawAmount.toLocaleString()} บาท`;
                            }

                            totalReport += `📋 ข้อมูลสมาชิกหมายเลข [ ${foundUser.memberNumber} ]\n` +
                                           `👤 ชื่อ: คุณ ${foundUser.name}\n` +
                                           `💰 เงินในระบบ: ${foundUser.balance.toLocaleString()} บาท\n` +
                                           ` ${withdrawStatusText}\n` +
                                           `🏦 ธนาคาร: ${foundUser.bankName || "ไม่ได้ระบุ"}\n` +
                                           `💳 เลข บช: ${foundUser.bankAccount || "ไม่ได้ระบุ"}`;
                        } else {
                            // ถ้าหาคนไหนไม่เจอ ให้รายงานแจ้งเตือนแยกคนไว้
                            totalReport += `❌ ไม่พบข้อมูลสมาชิกหมายเลข ${targetMemberId} ในระบบครับน้า`;
                        }

                        // ถ้ายังไม่ถึงคนสุดท้าย ให้ขีดเส้นคั่นแยกกล่องข้อมูลให้ชัดเจน
                        if (index < memberIds.length - 1) {
                            totalReport += `\n──────────────────\n`;
                        }
                    });

                    replyText = totalReport;
                }
            }
               // ==================== [ คำสั่งแอดมินส่องภาพรวมสมาชิกทุกคน (พิมพ์: oball) ] ====================
else if (userMsg.toLowerCase().startsWith('oball')) {
    // 🚨 กรองขั้นสูงสุด: ถ้าไม่ใช่แอดมิน หรือ แอดมินไม่ได้สั่งในแชทส่วนตัว (1 ต่อ 1) ให้บอทเงียบกริบไม่ตอบ
    if (!ADMIN_IDS.includes(userId) || event.source.type !== 'user') {
        return res.sendStatus(200);
    }

    const memberKeys = Object.keys(usersWallets);
    const totalMembers = memberKeys.length;

    if (totalMembers === 0) {
        global.currentReplyFlex = {
            "type": "text",
            "text": "📭 ปัจจุบันยังไม่มีสมาชิกสมัครเข้ามาในระบบเลยครับ"
        };
    } else {
        // 1. แยกหมายเลขหน้าที่แอดมินพิมพ์สั่งเข้ามา (เช่น 'oball 2' -> หน้า 2 / ถ้าพิมพ์แค่อีก 'oball' -> หน้า 1)
       const pageMatch = userMsg.match(/oball\s*(\d+)/i);
        let requestedPage = pageMatch ? parseInt(pageMatch[1], 10) : 1;
        if (isNaN(requestedPage) || requestedPage < 1) {
            requestedPage = 1;
        }
        
        const pageSize = 30; // แสดงผลชุดละ 30 คน (3 บับเบิล บับเบิลละ 10 คน เพื่อไม่ให้เกิน 50KB)
        const totalPages = Math.ceil(totalMembers / pageSize);

        // ตรวจสอบกรณีที่แอดมินพิมพ์เลขหน้าเกินจำนวนหน้าที่มีจริง
        if (requestedPage > totalPages) {
            requestedPage = totalPages;
        }

        // 2. ตัดดึงเฉพาะรายชื่อสมาชิกตามหน้าที่เลือก
        const startIndex = (requestedPage - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const pageMemberKeys = memberKeys.slice(startIndex, endIndex);

        // 3. แปลงข้อมูลสมาชิกในหน้านั้นๆ ให้เป็น Component ความจุเบา
        const pageMemberContents = pageMemberKeys.map(key => {
            const user = usersWallets[key];
            const isWithdrawing = global.withdrawQueue && global.withdrawQueue[key];
            const withdrawAmount = isWithdrawing ? global.withdrawQueue[key].amount : 0;

            return {
                "type": "box",
                "layout": "vertical",
                "backgroundColor": isWithdrawing ? "#2d1212" : "#1e1e24",
                "cornerRadius": "sm",
                "paddingAll": "sm",
                "margin": "xs",
                "contents": [
                    {
                        "type": "box",
                        "layout": "horizontal",
                        "contents": [
                            { "type": "text", "text": `[${user.memberNumber || "-"}] ${user.name}`, "weight": "bold", "color": "#ffffff", "size": "xs", "flex": 3, "wrap": false },
                            { "type": "text", "text": `${(user.balance || 0).toLocaleString()} ฿`, "color": "#00ff66", "size": "xs", "align": "end", "weight": "bold", "flex": 2 }
                        ]
                    },
                    {
                        "type": "box",
                        "layout": "horizontal",
                        "contents": [
                            { "type": "text", "text": `🏦 ${user.bankName || "-"}: ${user.bankAccount || "-"}`, "color": "#aaaaaa", "size": "xxs", "flex": 3 },
                            { "type": "text", "text": isWithdrawing ? `❌ ถอน ${withdrawAmount.toLocaleString()}` : "ปกติ", "color": isWithdrawing ? "#ff4d4d" : "#888888", "size": "xxs", "align": "end", "flex": 2 }
                        ]
                    }
                ]
            };
        });

        // 4. หั่นแบ่งสมาชิกในหน้านี้เป็น บับเบิลละ 10 คน (สูงสุด 3 บับเบิล/ชุดคำสั่ง)
        const chunkSize = 10;
        const memberBubblesData = [];
        for (let i = 0; i < pageMemberContents.length; i += chunkSize) {
            memberBubblesData.push(pageMemberContents.slice(i, i + chunkSize));
        }

        // 5. ประกอบเป็น Flex Bubble
        const oballBubbles = memberBubblesData.map((chunkContents, index) => {
            const currentSubPage = index + 1;
            const isLastBubble = (index === memberBubblesData.length - 1);

            const bubbleObj = {
                "type": "bubble",
                "size": "mega",
                "styles": { "body": { "backgroundColor": "#121214" } },
                "body": {
                    "type": "box",
                    "layout": "vertical",
                    "spacing": "xs",
                    "paddingAll": "md",
                    "contents": [
                        { "type": "text", "text": "📊 รายงานข้อมูลสมาชิก", "weight": "bold", "color": "#ffaa00", "size": "sm", "align": "center" },
                        { "type": "text", "text": `👥 รวม ${totalMembers} คน | ชุดที่ ${requestedPage}/${totalPages}`, "size": "xxs", "color": "#aaaaaa", "align": "center" },
                        { "type": "separator", "color": "#2a2a35", "margin": "xs" },
                        {
                            "type": "box",
                            "layout": "vertical",
                            "spacing": "none",
                            "contents": chunkContents
                        }
                    ]
                }
            };

            // ถ้าเป็นการ์ดใบสุดท้ายของชุดคำสั่งนั้น ให้ใส่ข้อความแนะนำพิมพ์ดูชุดถัดไป
            if (isLastBubble) {
                bubbleObj.body.contents.push(
                    { "type": "separator", "color": "#2a2a35", "margin": "sm" },
                    { 
                        "type": "text", 
                        "text": requestedPage < totalPages 
                            ? `💡 ดูชุดถัดไป พิมพ์: oball ${requestedPage + 1}` 
                            : `✅ สิ้นสุดรายการสมาชิกทั้งหมดแล้ว`, 
                        "size": "xxs", 
                        "color": "#00bfff", 
                        "align": "center",
                        "margin": "xs"
                    }
                );
            }

            return bubbleObj;
        });

        // 6. บันทึกลงตัวแปรเตรียมส่งกลับ
        global.currentReplyFlex = {
            "type": "flex",
            "altText": `📊 รายงานสมาชิกทั้งหมด (ชุดที่ ${requestedPage}/${totalPages})`,
            "contents": {
                "type": "carousel",
                "contents": oballBubbles
            }
        };
    }
}
    // ==================== [ คำสั่งแอดมิน: เช็กยอดเครดิตรวมสมาชิกทั้งหมด (พิมพ์: สรุป) ] ====================
else if (userMsg === 'สรุป' || userMsg === 'สรุป' || userMsg === 'สรุป') {
    // 🚨 กรองขั้นสูงสุด: เฉพาะแอดมินสั่งในแชทส่วนตัว (1 ต่อ 1) เท่านั้น
    if (!ADMIN_IDS.includes(userId) || event.source.type !== 'user') {
        return res.sendStatus(200);
    }

    // 1. วนลูปคำนวณยอดเครดิตรวม และนับจำนวนสมาชิกทั้งหมด
    let totalSystemBalance = 0;
    let totalMembers = 0;
    for (let key in usersWallets) {
        totalSystemBalance += (usersWallets[key].balance || 0);
        totalMembers++;
    }

    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

    // 2. ส่ง Flex Message สรุปผล
    global.currentReplyFlex = {
        "type": "flex",
        "altText": `📊 สรุปยอดเครดิตรวมในระบบ (${totalSystemBalance.toLocaleString()} บาท)`,
        "contents": {
            "type": "bubble",
            "styles": { "body": { "backgroundColor": "#121214" } },
            "body": {
                "type": "box",
                "layout": "vertical",
                "spacing": "md",
                "contents": [
                    { "type": "text", "text": "📈 สรุปยอดเครดิตรวมระบบ", "weight": "bold", "color": "#ffaa00", "size": "md", "align": "center" },
                    { "type": "text", "text": `📅 ข้อมูล ณ วันที่: ${todayStr}`, "size": "xs", "color": "#aaaaaa", "align": "center" },
                    { "type": "separator", "color": "#2a2a35" },

                    // 💳 การ์ดแสดงยอดรวม
                    {
                        "type": "box",
                        "layout": "vertical",
                        "backgroundColor": "#1e1e24",
                        "cornerRadius": "md",
                        "paddingAll": "lg",
                        "spacing": "xs",
                        "contents": [
                            { "type": "text", "text": "💰 เครดิตรวมสมาชิกทั้งหมด", "color": "#ffffff", "size": "xs", "weight": "bold" },
                            { "type": "text", "text": `${totalSystemBalance.toLocaleString()} ฿`, "color": "#00ff66", "size": "xl", "weight": "bold", "align": "end" },
                            { "type": "separator", "color": "#33333d", "margin": "sm" },
                            {
                                "type": "box",
                                "layout": "horizontal",
                                "margin": "xs",
                                "contents": [
                                    { "type": "text", "text": "• จำนวนสมาชิกทั้งหมด:", "color": "#aaaaaa", "size": "xs" },
                                    { "type": "text", "text": `${totalMembers} คน`, "color": "#ffaa00", "size": "xs", "align": "end", "weight": "bold" }
                                ]
                            }
                        ]
                    },

                    { "type": "separator", "color": "#2a2a35" },
                    { "type": "text", "text": "⚙️ คำนวณแบบ Real-time", "size": "xs", "color": "#666666", "align": "center" }
                ]
            }
        }
    };
}
            // ==================== [ เพิ่มใหม่: คำสั่งแอดมินลบสมาชิกรายคนผ่านแชทส่วนตัว (del1, del2...) ] ====================
            else if (userMsg.startsWith('d') && !userMsg.includes('-') && !userMsg.endsWith('+')) {
                if (!ADMIN_IDS.includes(userId) || event.source.type !== 'user') {
                    return res.sendStatus(200);
                }

                // ตัดคำว่า del ออกเพื่อเอาตัวเลขสมาชิกที่น้าต้องการลบ
                const targetIdStr = userMsg.replace('d', '').trim();
                const targetMemberId = parseInt(targetIdStr);

                if (!isNaN(targetMemberId)) {
                    let targetUserIdInFirebase = null;
                    let targetName = "";

                    // วนลูปค้นหาเพื่อถอดไอดี LINE ดิบของสมาชิกคนนั้นออกมาจากคลัง
                    for (let id in usersWallets) {
                        if (usersWallets[id].memberNumber === targetMemberId) {
                            targetUserIdInFirebase = id;
                            targetName = usersWallets[id].name;
                            break;
                        }
                    }

                    if (!targetUserIdInFirebase) {
                        replyText = `❌ ไม่พบข้อมูลสมาชิกหมายเลข ${targetMemberId} ในระบบครับน้า`;
                    } else {
                        // ❌ ทำการลบข้อมูลของสมาชิกคนนั้นออกจากออบเจกต์ระบบทันที
                        delete usersWallets[targetUserIdInFirebase];
                        
                        // บันทึกการเปลี่ยนแปลงขึ้นไปบนคลัง Firebase หลังบ้าน
                        await saveDataToFirebase();

                        replyText = `🗑️ ลบข้อมูลสำเร็จเรียบร้อยครับน้า!\n──────────────────\n🆔 สมาชิกหมายเลข: [ ${targetMemberId} ]\n👤 ชื่อเดิม: คุณ ${targetName}\n──────────────────\n✨ ตอนนี้สถานะของเขาถูกเคลียร์เป็นศูนย์เรียบร้อย สามารถให้เขาพิมพ์สมัครสมาชิกผูกบัญชีใหม่ในกลุ่มหลักได้เลยครับ`;
                    }
                }
            }
                // ==================== [ เพิ่มใหม่: คำสั่งแอดมินเช็ก ID LINE ตัวจริงของสมาชิก (id1, id2...) ] ====================
            else if (userMsg.startsWith('id') && !userMsg.includes('-') && !userMsg.endsWith('+')) {
                
                // 🚨 กรองขั้นสูงสุด: ถ้าไม่ใช่แอดมินในกล่องกลาง หรือ แอดมินไม่ได้สั่งในแชทส่วนตัว (1 ต่อ 1) ให้บอทเงียบกริบไม่ตอบ
                if (!ADMIN_IDS.includes(userId) || event.source.type !== 'user') {
                    return res.sendStatus(200);
                }

                const args = userMsg.split(/\s+/);
                const targetMemberId = parseInt(args[0].replace('id', '')); // ดึงตัวเลขจากคำว่า id12 -> 12

                if (!targetMemberId || isNaN(targetMemberId)) {
                    replyText = "❌ รูปแบบผิดครับน้า! ต้องพิมพ์เช่น: id12 (เพื่อเช็ก ID LINE ของสมาชิกเลขที่ 12)";
                } else {
                    let foundUserKey = null;
                    // ค้นหาในฐานข้อมูลกระเป๋าตังค์
                    for (let key in usersWallets) {
                        if (usersWallets[key].memberNumber === targetMemberId) {
                            foundUserKey = key; // key ก็คือ ID LINE (U...) นั่นเองครับ
                            break;
                        }
                    }

                    if (foundUserKey) {
                        const user = usersWallets[foundUserKey];
                        // 👑 พ่น ID LINE ตัวจริงออกมาให้แอดมินก๊อปปี้ได้ง่ายๆ
                        replyText = `👑 [ข้อมูล ID LINE สมาชิก]\n` +
                                    `──────────────────\n` +
                                    `🆔 สมาชิกลำดับที่: ${user.memberNumber}\n` +
                                    `👤 ชื่อ: ${user.name}\n` +
                                    `🔑 ID LINE (ก๊อปปี้ช่องนี้): \n\`${foundUserKey}\``; 
                                    // การใส่ `ครอบไว้ จะทำให้บนหน้าจอไลน์ของน้ากดจิ้มทีเดียวแล้วก๊อปปี้ข้อความได้เลยครับ
                    } else {
                        replyText = `❌ ไม่พบเลขสมาชิกที่ ${targetMemberId} ในระบบครับน้า`;
                    }
                }
            }
            // ==================== [  คำสั่งแอดมินรีเซ็ตระบบล้างกระดานผ่านแชทส่วนตัว (resetall) ] ====================
            else if (userMsg === 'ล้างระบบ') {
                const ADMIN_ID = "U2fb9233e5c539ae3970cbd698e2e18db"; // 👑 ไอดี LINE ของคุณน้า
                
                // 🚨 กรองขั้นสูงสุด: ถ้าไม่ใช่แอดมิน หรือ แอดมินไม่ได้สั่งในแชทส่วนตัว (1 ต่อ 1) ให้บอทเงียบกริบไม่ตอบ
                if (userId !== ADMIN_ID || event.source.type !== 'user') {
                    return res.sendStatus(200);
                }

                // 🔄 วนลูปเคลียร์ค่าสถานะการเงินและการเล่นของทุกคนในคลัง (แต่ยังคงเก็บข้อมูลบัญชีธนาคารและชื่อเอาไว้)
                for (let id in usersWallets) {
                    usersWallets[id].balance = 0;
                    usersWallets[id].turnoverTarget = 0;
                    usersWallets[id].turnoverCount = 0;
                    usersWallets[id].isWithdrawLocked = false;
                    usersWallets[id].pendingWithdrawAmount = 0;
                }

                // 🗑️ ล้างกระดานโพยเดิมที่ค้างอยู่ในรอบนั้นๆ ทั้งหมดให้โล่งสะอาด
                for (let id in roundBets) {
                    delete roundBets[id];
                }

                // บันทึกการล้างกระดานขึ้นไปบนคลัง Firebase หลังบ้านทันที
                await saveDataToFirebase();

                replyText = `♻️ รีเซ็ตระบบล้างกระดานสำเร็จเรียบร้อยครับน้า!\n──────────────────\n💰 เครดิตสมาชิกทุกคน: ปรับเป็น 0 บาท\n🔒 เคลียร์ค่าเทิร์นคงค้าง: ปกติทั้งหมด\n📝 ข้อมูลโพยเดิมในรอบ: ล้างกระดานโล่ง 100%\n──────────────────\n✨ พร้อมสำหรับเริ่มเปิดห้องรอบใหม่แล้วครับโผม!`;
            }
             // ==================== [ 🕒 ระบบดักจับการพิมพ์ตัวเลขนับถอยหลัง 3, 2, 1 ] ====================
if (userMsg === '3' || userMsg === '2' || userMsg === '1') {
    // เช็กสิทธิ์แอดมินก่อนทำงาน
    if (ADMIN_IDS.includes(userId)) {
        replyText = "COUNTDOWN_IMAGE_TRIGGER"; // 👈 ใส่ข้อความหลอกไว้ เพื่อให้บล็อกส่งไลน์ด้านล่างยอมทำงาน
    }
}

            // ==================== [ จุดตรวจสอบคัดกรอง: ป้องกันไม่ให้บุคคลทั่วไปใช้งานบอทในแชทส่วนตัว ] ====================
            if (event.source.type === 'user') {
                // 👥 เช็กว่า ID คนทักอยู่ในกล่องแอดมินรวมไหม ถ้ายืนยันว่าไม่ใช่แอดมิน ให้บอท "นิ่งเงียบสนิท" ทันที
                if (!ADMIN_IDS.includes(userId)) {
                    return res.sendStatus(200);
                }
            }

            //==========================================================
        
           // ==================== [ 🚀 บล็อกยิงข้อความตอบกลับ LINE แบบสมบูรณ์ ป้องกันข้อความว่าง ] ====================
            if (replyText || global.currentReplyFlex) {
                try {
                    let sendMessages = [];

                    // 🌟 1. ดักจับ Flex Message (การ์ดดำทอง) ถ้ามีค่าให้ยัดลงถังเป็นอย่างแรก
                    if (global.currentReplyFlex) {
                        sendMessages.push(global.currentReplyFlex);
                    }

                    else if (userMsg === 'กต') {
                        sendMessages.unshift({
                            type: 'image',
                            originalContentUrl: 'https://img2.pic.in.th/Modern-Game-Rules-Poster-for-Pokdeng.jpg', 
                            previewImageUrl: 'https://img2.pic.in.th/Modern-Game-Rules-Poster-for-Pokdeng.jpg'     
                        },
                        {
                            type: 'image',
                            originalContentUrl: 'https://img2.pic.in.th/Abstract-Playful-Classroom-Rules.jpg', 
                            previewImageUrl: 'https://img2.pic.in.th/Abstract-Playful-Classroom-Rules.jpg'     
                        });
                    }
                    else if (userMsg === 'คส') {
                        replyText = null;
                        sendMessages = [{
                            type: 'image',
                            originalContentUrl: 'https://img1.pic.in.th/images/546565.png', 
                            previewImageUrl: 'https://img1.pic.in.th/images/546565.png'     
                        }];
                    }
                    
                    // 🌟 3. ส่งข้อความตัวหนังสือปกติ (ดักจับ: ต้องไม่เป็นค่าว่าง ไม่เป็น null)
                    if (replyText && replyText.trim() !== "") {
                        sendMessages.push({ type: 'text', text: replyText });
                    }

                    // 🧼 เคลียร์ค่าแรมของ Flex ออกเพื่อป้องกันบั๊กค้างคาในระบบ
                    global.currentReplyFlex = null; 
                    
                    // 🚀 4. สั่งยิงข้อมูลหา LINE (ถ้าในถังมีข้อความหรือรูปภาพ ให้ทำการส่งทันที)
                    if (sendMessages.length > 0) {
                        await axios.post('https://api.line.me/v2/bot/message/reply', {
                            replyToken: replyToken,
                            messages: sendMessages 
                        }, {
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${TOKEN}`
                            }
                        });
                    }
                } catch (error) {
                    console.error("❌ ส่งข้อความกลับล้มเหลว:", error.response ? error.response.data : error.message);
                }
            }
        }
    }
    res.sendStatus(200);
});

app.get('/', (req, res) => { res.send('ระบบลงทะเบียนรันปกติ'); });
app.listen(process.env.PORT || 3000, () => { console.log('Server is running...'); });
// เปิดทางให้เข้าถึงไฟล์รูปภาพสลิปที่เซฟไว้ในเครื่องได้ตรงๆ
app.use(express.static(__dirname));
