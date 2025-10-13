// public/admin/admin.js (최종 수정)

// Socket.IO 변수 선언 (연결은 페이지 로직 내에서 수행)
let socket; 

document.addEventListener('DOMContentLoaded', () => {
    // 1. 로그인 페이지 로직
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', handleSubmitLogin);
    }

    // Socket.IO 연결은 payment/serving 페이지에서만 수행
    if (document.body.classList.contains('payment-page') || document.body.classList.contains('serving-page')) {
        // <script src="/socket.io/socket.io.js"></script>가 HTML에 필요합니다.
        socket = io(); // ✅ Socket.IO 연결을 필요한 시점에 수행
    }

    // 2. 입금 확인 페이지 로직 (payment.html)
    if (document.body.classList.contains('payment-page')) {
        fetchOrders();
        document.getElementById('pending-orders-tbody').addEventListener('click', handlePaymentConfirmation);
        
        // Socket.IO로 새로운 주문 알림 받기
        if (socket) {
            socket.on('new_pending_order', () => {
                console.log("새 입금 대기 주문 알림 수신. 목록 업데이트.");
                fetchOrders(); 
            });
        }
    }

    // 3. 서빙 페이지 로직 (serving.html)
    if (document.body.classList.contains('serving-page')) {
        fetchServingItems();
        document.getElementById('serving-items-tbody').addEventListener('click', handleServingCompletion);
        
        // Socket.IO 리스너 추가: 주방에서 'ready_to_serve' 신호가 오면 서빙 목록 업데이트
        if (socket) {
            socket.on('item_status_updated', (data) => {
                if (data.new_status === 'ready_to_serve') {
                    // ✅ 주방에서 조리 완료 (ready_to_serve) 신호가 오면 서빙 목록 업데이트
                    console.log(`메뉴 ${data.item_id} 조리 완료 알림 수신. 서빙 목록 업데이트.`);
                    fetchServingItems();
                }
            });

            // 다른 클라이언트가 서빙 완료 처리하면 목록 업데이트
            socket.on('serving_completed_push', () => {
                // 서빙 완료된 항목을 목록에서 제거하기 위해 새로고침
                fetchServingItems();
            });
        }
    }
});

// ==========================================================
// 1. 로그인 폼 제출 처리 함수 (login.html)
// ==========================================================
async function handleSubmitLogin(event) {
    event.preventDefault(); 

    const passwordInput = document.getElementById('admin-password');
    const password = passwordInput.value;
    const messageElement = document.getElementById('login-message');

    messageElement.textContent = ''; 
    
    if (password.trim() === '') {
        messageElement.textContent = '비밀번호를 입력하세요.';
        return;
    }

    try {
        const response = await fetch('/api/admin/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: password })
        });
        
        const result = await response.json();
        
        if (response.ok && result.authenticated) {
            // 인증 성공 시 payment.html로 리다이렉션
            messageElement.textContent = '✅ 로그인 성공! 페이지를 이동합니다.';
            window.location.href = '/admin/payment.html'; 
        } else {
            // 인증 실패 시
            messageElement.textContent = `❌ 인증 실패: ${result.error || '비밀번호가 일치하지 않습니다.'}`;
            passwordInput.value = '';
        }
    } catch (error) {
        console.error('인증 API 통신 오류:', error);
        messageElement.textContent = '서버 통신 오류로 로그인이 실패했습니다.';
    }
}


// ==========================================================
// 2. 입금 확인 페이지 로직 (payment.html)
// ==========================================================

async function fetchOrders() {
    try {
        const response = await fetch('/api/admin/orders');
        if (!response.ok) throw new Error('주문 데이터를 가져오는 데 실패했습니다.');
        const data = await response.json();
        
        const pendingOrders = data.orders.filter(order => !order.is_paid); // is_paid: false
        const confirmedOrders = data.orders.filter(order => order.is_paid);   // is_paid: true

        renderOrders(pendingOrders, 'pending-orders-tbody');
        renderOrders(confirmedOrders, 'confirmed-orders-tbody');
        
        document.getElementById('pending-count').textContent = pendingOrders.length;
        document.getElementById('confirmed-count').textContent = confirmedOrders.length;

    } catch (error) {
        console.error('API 통신 오류:', error);
    }
}

function renderOrders(orders, tbodyId) {
    const tbody = document.getElementById(tbodyId);
    tbody.innerHTML = '';

    orders.forEach(order => {
        const orderDetails = order.items.map(item => 
            `${item.name} x ${item.quantity}개`
        ).join('<br>'); // ✅ <br>로 수정하여 HTML에서 줄바꿈이 되도록 함

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>#${order.order_id}</td>
            <td>${order.booth_id}</td>
            <td>${order.total_price.toLocaleString('ko-KR')}</td>
            <td><div class="order-details">${orderDetails}</div></td>
            <td>${formatTime(order.order_time)}</td>
            <td>
                ${!order.is_paid 
                    ? `<button class="confirm-btn" data-order-id="${order.order_id}">입금 확인</button>`
                    : `<span class="status-confirmed">확인 완료</span>`}
            </td>
        `;
        tbody.appendChild(row);
    });
}

async function handlePaymentConfirmation(event) {
    if (!event.target.classList.contains('confirm-btn')) return;

    const button = event.target;
    const orderId = button.dataset.orderId;

    if (!confirm(`주문 #${orderId}의 입금을 확인 완료하고 조리 대기 상태로 전환하시겠습니까?`)) return;
    
    button.disabled = true;

    try {
        const response = await fetch('/api/admin/confirm-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: orderId })
        });

        if (!response.ok) throw new Error('입금 확인 처리에 실패했습니다.');

        // Socket.IO 로직: DB 업데이트 성공 후 서버에 신호 전송
        if (socket) {
            socket.emit('payment_confirmed_push', { order_id: orderId });
        }

        alert(`주문 #${orderId} 입금 확인 처리 완료. 주방으로 전송되었습니다.`);
        await fetchOrders(); // 목록 업데이트

    } catch (error) {
        console.error('입금 확인 오류:', error);
        alert(`주문 #${orderId} 입금 확인 처리 중 오류가 발생했습니다.`);
        button.disabled = false;
    }
}


// ==========================================================
// 3. 서빙 완료 페이지 로직 (serving.html)
// ==========================================================

async function fetchServingItems() {
    try {
        const response = await fetch('/api/admin/serving-items');
        if (!response.ok) throw new Error('서빙 데이터를 가져오는 데 실패했습니다.');
        const data = await response.json();
        
        renderServingItems(data.items, 'serving-items-tbody');
        document.getElementById('serving-count').textContent = data.items.length;

    } catch (error) {
        console.error('서빙 목록 API 오류:', error);
    }
}

function renderServingItems(items, tbodyId) {
    const tbody = document.getElementById(tbodyId);
    tbody.innerHTML = '';

    items.forEach(item => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${item.menu_name}</td>
            <td>${item.quantity}</td>
            <td>${item.booth_id}</td>
            <td>#${item.order_id}</td>
            <td>${formatTime(item.order_time)}</td> 
            <td>
                <button class="serve-btn" 
                        data-item-id="${item.item_id}"
                        data-order-id="${item.order_id}">서빙 완료</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

async function handleServingCompletion(event) {
    if (!event.target.classList.contains('serve-btn')) return;

    const button = event.target;
    const itemId = button.dataset.itemId;
    const orderId = button.dataset.orderId;

    if (!confirm(`주문 #${orderId}의 메뉴 (ID: ${itemId})를 서빙 완료하시겠습니까?`)) return;
    
    button.disabled = true;

    try {
        const response = await fetch('/api/admin/complete-serving', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_id: itemId, order_id: orderId })
        });

        if (!response.ok) throw new Error('서빙 완료 처리에 실패했습니다.');

        // Socket.IO 로직: DB 업데이트 성공 후 서버에 신호 전송
        if (socket) {
            socket.emit('serving_completed_push', { item_id: itemId, order_id: orderId });
        }
        
        alert(`메뉴 (주문 #${orderId}) 서빙 완료 처리되었습니다.`);
        await fetchServingItems(); // 목록 업데이트

    } catch (error) {
        console.error('서빙 완료 오류:', error);
        alert(`서빙 완료 처리 중 오류가 발생했습니다.`);
        button.disabled = false;
    }
}


// ==========================================================
// 4. 공통 유틸리티
// ==========================================================

function formatTime(isoTime) {
    const date = new Date(isoTime);
    return date.toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}