// server.js
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import mysql from 'mysql2/promise';
import cors from 'cors';
import path from 'path';
import bodyParser from 'body-parser';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const __dirname = path.resolve();

// ✅ 미들웨어
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ✅ MySQL 연결
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '0000',
  database: 'yeonsung_pub_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// ✅ 클라이언트 연결 시 로그
io.on('connection', (socket) => {
  console.log('✅ 클라이언트 연결됨:', socket.id);

  // 주문 제출 이벤트
  socket.on('submit_order', async (orderData) => {
    try {
      const [result] = await pool.query(
        `INSERT INTO orders (booth_id, total_price, status, payment_status, order_time, note)
         VALUES (?, ?, 'pending', 'unpaid', NOW(), ?)`,
        [orderData.booth_id, orderData.total_price, orderData.note || null]
      );

      const orderId = result.insertId;

      // 주문 항목 저장
      for (const item of orderData.items) {
        await pool.query(`
            INSERT INTO order_items (order_id, menu_id, quantity, unit_price)
            VALUES (?, ?, ?, ?)
            `, [orderId, item.menu_id, item.quantity, item.unit_price]);

      }

      console.log('✅ 주문 저장 완료:', orderId);

      // 관리자 페이지 실시간 업데이트
      io.emit('new_pending_order');
    } catch (error) {
      console.error('❌ 주문 저장 중 오류:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('❎ 클라이언트 연결 해제:', socket.id);
  });
});


// ============================
// ✅ 관리자 API
// ============================

// 1️⃣ 모든 주문 조회 (결제 상태 관계없이)
app.get('/api/admin/orders', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        o.order_id,
        o.booth_id,
        o.total_price,
        o.order_time,
        o.status,
        o.payment_status,
        GROUP_CONCAT(CONCAT(m.name, ':', oi.quantity)) AS items
      FROM orders o
      JOIN order_items oi ON o.order_id = oi.order_id
      JOIN menus m ON oi.menu_id = m.menu_id
      GROUP BY o.order_id
      ORDER BY o.order_time DESC
    `);

    const formatted = rows.map(order => ({
      order_id: order.order_id,
      booth_id: order.booth_id,
      total_price: order.total_price,
      order_time: order.order_time,
      status: order.status,
      payment_status: order.payment_status,
      is_paid: order.payment_status === 'paid',
      items: order.items
        ? order.items.split(',').map(i => {
            const [name, qty] = i.split(':');
            return { name, quantity: Number(qty) };
          })
        : [],
    }));

    res.json({ orders: formatted });
  } catch (err) {
    console.error('❌ 관리자 주문 조회 오류:', err);
    res.status(500).json({ error: '서버 오류' });
  }
});


// 2️⃣ 결제 확인 처리
app.post('/api/admin/confirm-payment', async (req, res) => {
  const { order_id } = req.body;
  try {
    await pool.query(`
      UPDATE orders 
      SET payment_status = 'paid', status = 'preparing'
      WHERE order_id = ?`, [order_id]);
    io.emit('new_serving_item');
    res.json({ success: true });
  } catch (err) {
    console.error('❌ 결제 확인 오류:', err);
    res.status(500).json({ error: '서버 오류' });
  }
});


// 3️⃣ 서빙 항목 조회 (준비 중 + 결제 완료)
app.get('/api/admin/serving-items', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        o.order_id,
        o.booth_id,
        o.total_price,
        o.order_time,
        o.status,
        o.payment_status,
        GROUP_CONCAT(CONCAT(m.name, ':', oi.quantity)) AS items
      FROM orders o
      JOIN order_items oi ON o.order_id = oi.order_id
      JOIN menus m ON oi.menu_id = m.menu_id
      WHERE o.payment_status = 'paid' AND o.status IN ('preparing', 'serving')
      GROUP BY o.order_id
      ORDER BY o.order_time DESC
    `);

    const formatted = rows.map(order => ({
      order_id: order.order_id,
      booth_id: order.booth_id,
      total_price: order.total_price,
      order_time: order.order_time,
      status: order.status,
      payment_status: order.payment_status,
      items: order.items
        ? order.items.split(',').map(i => {
            const [name, qty] = i.split(':');
            return { name, quantity: Number(qty) };
          })
        : [],
    }));

    res.json({ servingItems: formatted });
  } catch (err) {
    console.error('❌ 서빙 항목 조회 오류:', err);
    res.status(500).json({ error: '서버 오류' });
  }
});


// 4️⃣ 완료 처리
app.post('/api/admin/complete-order', async (req, res) => {
  const { order_id } = req.body;
  try {
    await pool.query(`
      UPDATE orders 
      SET status = 'completed'
      WHERE order_id = ?`, [order_id]);
    io.emit('new_completed_order');
    res.json({ success: true });
  } catch (err) {
    console.error('❌ 주문 완료 처리 오류:', err);
    res.status(500).json({ error: '서버 오류' });
  }
});


// 5️⃣ 완료된 주문 조회
app.get('/api/admin/completed-orders', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        o.order_id,
        o.booth_id,
        o.total_price,
        o.order_time,
        o.status,
        o.payment_status,
        GROUP_CONCAT(CONCAT(m.name, ':', oi.quantity)) AS items
      FROM orders o
      JOIN order_items oi ON o.order_id = oi.order_id
      JOIN menus m ON oi.menu_id = m.menu_id
      WHERE o.status = 'completed'
      GROUP BY o.order_id
      ORDER BY o.order_time DESC
    `);

    const formatted = rows.map(order => ({
      order_id: order.order_id,
      booth_id: order.booth_id,
      total_price: order.total_price,
      order_time: order.order_time,
      status: order.status,
      payment_status: order.payment_status,
      items: order.items
        ? order.items.split(',').map(i => {
            const [name, qty] = i.split(':');
            return { name, quantity: Number(qty) };
          })
        : [],
    }));

    res.json({ completedOrders: formatted });
  } catch (err) {
    console.error('❌ 완료 주문 조회 오류:', err);
    res.status(500).json({ error: '서버 오류' });
  }
});


// ============================
// ✅ 기본 페이지 라우트
// ============================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'payment.html'));
});


// ============================
// ✅ 서버 실행
// ============================
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
});
