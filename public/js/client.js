// public/js/client.js (최종 통합 버전)

const socket = io();
const menuListEl = document.getElementById('menu-list');
const boothNumberEl = document.getElementById('booth-number');
const totalQuantityEl = document.getElementById('total-quantity');
const totalPriceEl = document.getElementById('total-price');
const orderSubmitBtn = document.getElementById('order-submit-btn');
const viewOrdersBtn = document.getElementById('view-orders-btn');
const orderHistoryModal = document.getElementById('order-history-modal');
const modalCloseBtn = orderHistoryModal.querySelector('.close-btn');
const modalBoothIdEl = document.getElementById('modal-booth-id');
const orderHistoryListEl = document.getElementById('order-history-list');

let menus = [];
let cart = {}; // { menu_id: quantity }
let boothId = 'N/A';

// URL에서 부스 번호를 가져오는 함수
function getBoothIdFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('booth') || 'N/A';
    boothId = id;
    boothNumberEl.textContent = `테이블: ${id}번 부스`;
}

// 메뉴 목록을 서버에서 가져와 렌더링
async function loadMenus() {
    try {
        const response = await fetch('/api/menus');
        
        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }
        
        menus = await response.json();

        if (menus.length === 0) {
             menuListEl.innerHTML = '<p style="text-align: center; color: var(--color-light-gray);">😭 메뉴가 등록되어 있지 않습니다. DB를 확인해 주세요.</p>';
             return;
        }

        menuListEl.innerHTML = ''; 
        menus.forEach(menu => {
            const card = createMenuCard(menu);
            menuListEl.appendChild(card);
        });
    } catch (error) {
        console.error("메뉴 로드 실패:", error);
        menuListEl.innerHTML = `
            <p style="text-align: center; color: var(--color-secondary); font-weight: bold;">
                😭 메뉴를 불러오는 데 실패했습니다.<br>
                서버 상태(DB 연결, Node.js 실행)를 확인하세요.
            </p>
        `;
    }
}

// 단일 메뉴 카드 생성
function createMenuCard(menu) {
    const card = document.createElement('div');
    card.className = 'menu-card';
    card.dataset.id = menu.menu_id;

    const priceFormatted = menu.price.toLocaleString() + '원'; 

    card.innerHTML = `
        <img src="assets/${menu.image_url || 'default.jpg'}" alt="${menu.name}" class="menu-image">
        <div class="menu-details">
            <h3>${menu.name}</h3>
            <p class="description">${menu.description || ''}</p>
            <p class="price">${priceFormatted}</p>
            <div class="quantity-control">
                <button class="btn-minus" data-id="${menu.menu_id}">-</button>
                <span class="quantity" data-id="${menu.menu_id}">0</span>
                <button class="btn-plus" data-id="${menu.menu_id}">+</button>
            </div>
        </div>
    `;
    return card;
}

// 장바구니 업데이트 및 UI 반영
function updateCartUI() {
    let totalQuantity = 0;
    let totalPrice = 0;
    let hasItems = false;

    menus.forEach(menu => {
        const menuId = menu.menu_id;
        const quantity = cart[menuId] || 0;
        
        const quantitySpan = document.querySelector(`.quantity[data-id="${menuId}"]`);
        if (quantitySpan) {
            quantitySpan.textContent = quantity;
        }

        if (quantity > 0) {
            totalQuantity += quantity;
            totalPrice += quantity * menu.price;
            hasItems = true;
        }
    });

    totalQuantityEl.textContent = totalQuantity;
    totalPriceEl.textContent = totalPrice.toLocaleString() + '원';
    
    orderSubmitBtn.disabled = !hasItems;
}

// 이벤트 리스너: + / - 버튼 클릭 처리
menuListEl.addEventListener('click', (e) => {
    const target = e.target;
    if (target.classList.contains('btn-plus') || target.classList.contains('btn-minus')) {
        const menuId = parseInt(target.dataset.id);
        const currentQuantity = cart[menuId] || 0;

        if (target.classList.contains('btn-plus')) {
            cart[menuId] = currentQuantity + 1;
        } else if (target.classList.contains('btn-minus') && currentQuantity > 0) {
            cart[menuId] = currentQuantity - 1;
        }

        if (cart[menuId] === 0) {
            delete cart[menuId];
        }

        updateCartUI();
    }
});

// 서버에서 주문 내역을 가져와 모달에 표시
async function loadOrderHistory() {
    if (boothId === 'N/A') {
        orderHistoryListEl.innerHTML = '<p class="error-text">테이블 번호를 확인할 수 없습니다.</p>';
        return;
    }

    try {
        orderHistoryListEl.innerHTML = '<p class="loading-text">주문 내역을 불러오는 중...</p>';
        
        // 새 API 엔드포인트 호출: /api/orders/{boothId}
        const response = await fetch(`/api/orders/${boothId}`);
        
        if (!response.ok) throw new Error('주문 내역 로드 실패');
        
        const orders = await response.json();
        
        renderOrderHistory(orders);

    } catch (error) {
        console.error("주문 내역 로드 실패:", error);
        orderHistoryListEl.innerHTML = '<p class="error-text">😭 주문 내역을 불러오는 데 오류가 발생했습니다.</p>';
    }
}

// 주문 내역을 HTML로 렌더링
function renderOrderHistory(orders) {
    orderHistoryListEl.innerHTML = ''; 

    if (orders.length === 0) {
        orderHistoryListEl.innerHTML = '<p style="text-align: center; color: var(--color-light-gray);">아직 주문 내역이 없습니다.</p>';
        return;
    }

    orders.forEach(order => {
        const itemsHtml = order.items.map(item => `
            <li>${item.name} x ${item.quantity} (${item.unit_price.toLocaleString()}원/개)</li>
        `).join('');
        
        const statusText = order.status === 'pending' ? '대기 중' : 
                           order.status === 'processing' ? '조리 중' : 
                           '✅ 완료';

        const card = document.createElement('div');
        card.className = 'history-card';
        card.innerHTML = `
            <div class="history-header">
                <span>주문 시간: ${order.order_time}</span>
                <span class="history-status status-${order.status}">${statusText}</span>
            </div>
            <ul>${itemsHtml}</ul>
            <p style="font-weight: bold; text-align: right; margin-top: 10px;">총 금액: ${order.total_price.toLocaleString()}원</p>
        `;
        orderHistoryListEl.appendChild(card);
    });
}

// 주문 전송
orderSubmitBtn.addEventListener('click', () => {
    if (orderSubmitBtn.disabled) return;

    if (boothId === 'N/A') {
        alert('테이블(부스) 번호가 확인되지 않아 주문할 수 없습니다. 다시 로그인해 주세요.');
        return;
    }

    const orderItems = Object.keys(cart)
        .filter(menuId => cart[menuId] > 0)
        .map(menuId => {
            const menu = menus.find(m => m.menu_id == menuId);
            return {
                menu_id: parseInt(menuId),
                quantity: cart[menuId],
                price: menu.price
            };
        });

    if (orderItems.length === 0) {
        alert('주문할 메뉴를 선택해 주세요.');
        return;
    }

    const totalOrderPrice = orderItems.reduce((sum, item) => sum + (item.quantity * item.price), 0);
    
    const confirmation = confirm(`${boothId}번 테이블의 총 ${totalOrderPrice.toLocaleString()}원을 주문하시겠습니까?`);

    if (confirmation) {
        const orderData = {
            booth_id: boothId,
            total_price: totalOrderPrice,
            items: orderItems
        };

        socket.emit('submit_order', orderData);
        alert(`테이블 ${boothId}번의 주문이 성공적으로 접수되었습니다! 잠시만 기다려 주세요.`);
        
        // 주문 완료 후 장바구니 초기화
        cart = {};
        updateCartUI();
    }
});

// 주문 내역 버튼 이벤트 리스너 추가
viewOrdersBtn.addEventListener('click', () => {
    modalBoothIdEl.textContent = boothId;
    orderHistoryModal.style.display = 'block';
    loadOrderHistory(); // 주문 내역 로드 시작
});

// 모달 닫기 이벤트 (X 버튼)
modalCloseBtn.addEventListener('click', () => {
    orderHistoryModal.style.display = 'none';
});

// 모달 외부 클릭 시 닫기
window.addEventListener('click', (event) => {
    if (event.target === orderHistoryModal) {
        orderHistoryModal.style.display = 'none';
    }
});

// 초기화
getBoothIdFromUrl();
loadMenus();