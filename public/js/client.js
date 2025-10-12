// public/js/client.js (최종 통합 버전)

const socket = io();

// 1. DOM 요소 참조
const boothNumberEl = document.getElementById('booth-number');
const cartBadgeEl = document.getElementById('cart-badge');
const menuListEl = document.getElementById('menu-list');
const categoryTabsEl = document.getElementById('category-tabs');
const cartIconEl = document.getElementById('cart-icon');

// 메뉴 상세 모달 요소
const detailModal = document.getElementById('detail-modal');
const detailCloseBtn = document.getElementById('detail-close-btn');
const modalMenuImage = document.getElementById('modal-menu-image');
const modalMenuCategory = document.getElementById('modal-menu-category');
const modalMenuName = document.getElementById('modal-menu-name');
const modalMenuDescription = document.getElementById('modal-menu-description');
const modalMenuPrice = document.getElementById('modal-menu-price');
const modalQuantityEl = document.getElementById('modal-quantity');
const modalBtnMinus = document.getElementById('modal-btn-minus');
const modalBtnPlus = document.getElementById('modal-btn-plus');
const addToCartBtn = document.getElementById('add-to-cart-btn');

// 장바구니 보기 모달 요소
const cartViewModal = document.getElementById('cart-view-modal');
const cartViewCloseBtn = document.getElementById('cart-view-close-btn');
const cartItemsListEl = document.getElementById('cart-items-list');
const cartViewTotalPriceEl = document.getElementById('cart-view-total-price');
const cartSubmitBtn = document.getElementById('cart-submit-btn');

// 주문 내역 모달 요소
const orderHistoryModal = document.getElementById('order-history-modal');
const historyCloseBtn = document.getElementById('history-close-btn');
const modalBoothIdEl = document.getElementById('modal-booth-id');
const orderHistoryListEl = document.getElementById('order-history-list');

// 2. 상태 변수
let menus = []; // 전체 메뉴 목록
let cart = {}; // { menu_id: { quantity: N, price: P, name: S, ... } }
let boothId = 'N/A';
let currentDetailMenu = null; // 현재 상세 모달에 표시된 메뉴 객체


// ===========================================
// 3. 초기화 및 데이터 로드
// ===========================================

function getBoothIdFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('booth') || 'N/A';
    boothId = id;
    boothNumberEl.textContent = `테이블: ${id}번 부스`;
}

async function loadMenus() {
    try {
        const response = await fetch('/api/menus');
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
        
        menus = await response.json();
        if (menus.length === 0) {
            menuListEl.innerHTML = '<p style="text-align: center; color: var(--color-light-gray);">😭 메뉴가 등록되어 있지 않습니다. DB를 확인해 주세요.</p>';
            return;
        }

        renderCategoryTabs(menus);
        filterAndRenderMenus('전체'); // 기본적으로 '전체' 메뉴 표시

    } catch (error) {
        console.error("메뉴 로드 실패:", error);
        menuListEl.innerHTML = `
            <p style="text-align: center; color: var(--color-secondary); font-weight: bold; padding-top: 50px;">
                😭 메뉴를 불러오는 데 실패했습니다.<br>서버 상태(DB 연결, Node.js 실행)를 확인하세요.
            </p>
        `;
    }
}


// ===========================================
// 4. 메뉴 UI (카테고리 & 리스트)
// ===========================================

// 카테고리 순서를 '사이드' -> '메인'으로 변경
function renderCategoryTabs(allMenus) {
    const dbCategories = [...new Set(allMenus.map(m => m.category).filter(c => c && c !== '이벤트'))];
    
    let finalCategories = ['전체'];

    // 1. '사이드' 추가
    if (dbCategories.includes('사이드')) {
        finalCategories.push('사이드');
    }
    // 2. '메인' 추가
    if (dbCategories.includes('메인')) {
        finalCategories.push('메인');
    }

    // 3. 나머지 카테고리 추가
    dbCategories.forEach(cat => {
        if (cat !== '사이드' && cat !== '메인') {
            finalCategories.push(cat);
        }
    });
    
    // 4. '이벤트'를 가장 마지막에 추가
    finalCategories.push('이벤트');

    // 탭 버튼 렌더링
    categoryTabsEl.innerHTML = finalCategories.map(cat => 
        `<button class="tab-button ${cat === '전체' ? 'active' : ''}" data-category="${cat}">${cat}</button>`
    ).join('');
}

// 카테고리별 메뉴 필터링 및 렌더링
function filterAndRenderMenus(category) {
    let filteredMenus = menus;
    
    if (category === '이벤트') {
        menuListEl.innerHTML = `
            <p style="text-align: center; color: var(--color-light-gray); padding-top: 50px;">
                현재 진행 중인 이벤트가 없습니다.
            </p>`;
        return;
    }

    if (category !== '전체') {
        filteredMenus = menus.filter(menu => menu.category === category);
    }
    
    menuListEl.innerHTML = ''; 
    if (filteredMenus.length === 0) {
        menuListEl.innerHTML = `<p style="text-align: center; color: var(--color-light-gray); padding-top: 50px;">
            선택하신 카테고리의 메뉴가 없습니다.
        </p>`;
        return;
    }

    filteredMenus.forEach(menu => {
        const card = createMenuCard(menu);
        menuListEl.appendChild(card);
    });
}

// 단일 메뉴 카드 생성 (클릭 가능한 UI)
function createMenuCard(menu) {
    const card = document.createElement('div');
    card.className = 'menu-card';
    card.dataset.id = menu.menu_id;
    card.addEventListener('click', () => openDetailModal(menu.menu_id)); // 클릭 시 상세 모달 열기

    const priceFormatted = menu.price.toLocaleString() + '원'; 

    card.innerHTML = `
        <img src="assets/${menu.image_url || 'default.jpg'}" alt="${menu.name}" class="menu-image">
        <div class="menu-details">
            <h3 style="margin-bottom: 5px;">${menu.name}</h3>
            <p class="description">${menu.description || ''}</p>
            <p class="price" style="margin-top: 8px;">${priceFormatted}</p>
        </div>
    `;
    return card;
}


// ===========================================
// 5. 메뉴 상세 모달 로직
// ===========================================

function openDetailModal(menuId) {
    const menu = menus.find(m => m.menu_id == menuId);
    if (!menu) return;
    
    currentDetailMenu = menu;
    
    // 장바구니에 이미 담겨있는 경우 수량 불러오기, 없으면 1로 초기화
    let initialQuantity = cart[menuId] ? cart[menuId].quantity : 1;
    
    // UI 업데이트
    modalMenuImage.src = `assets/${menu.image_url || 'default.jpg'}`;
    modalMenuCategory.textContent = menu.category || '기타';
    modalMenuName.textContent = menu.name;
    modalMenuDescription.textContent = menu.description || '상세 설명 없음';
    
    // 수량 및 가격 업데이트
    updateDetailModal(initialQuantity);

    detailModal.style.display = 'block';
}

function updateDetailModal(quantity) {
    if (!currentDetailMenu) return;

    if (quantity < 1) quantity = 1; // 최소 수량 1

    // 수량 업데이트
    modalQuantityEl.textContent = quantity;
    
    // 총 가격 업데이트
    const totalPrice = currentDetailMenu.price * quantity;
    addToCartBtn.textContent = `${totalPrice.toLocaleString()}원 담기`;
    addToCartBtn.dataset.quantity = quantity;
}


// ===========================================
// 6. 장바구니 UI 및 로직
// ===========================================

// 장바구니 UI 업데이트 (뱃지, 총액)
function updateCartBadge() {
    let totalQuantity = 0;
    let totalPrice = 0;
    
    // cart 객체 순회하며 총 개수/가격 계산
    Object.values(cart).forEach(item => {
        totalQuantity += item.quantity;
        totalPrice += item.quantity * item.price;
    });

    cartBadgeEl.textContent = totalQuantity;
    cartBadgeEl.style.display = totalQuantity > 0 ? 'block' : 'none';
    
    // 장바구니 모달 푸터 업데이트
    cartViewTotalPriceEl.textContent = totalPrice.toLocaleString() + '원';
    cartSubmitBtn.disabled = totalQuantity === 0;
}

// 장바구니 보기 모달 렌더링
function renderCartView() {
    cartItemsListEl.innerHTML = '';
    const items = Object.values(cart);
    
    if (items.length === 0) {
        cartItemsListEl.innerHTML = '<p style="text-align: center; color: var(--color-light-gray); padding: 30px;">장바구니가 비어 있습니다.</p>';
        return;
    }

    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'cart-item';
        div.dataset.id = item.menu_id;
        
        div.innerHTML = `
            <div class="cart-item-info">
                <div class="cart-item-name">${item.name}</div>
                <div class="cart-item-price">${item.price.toLocaleString()}원</div>
            </div>
            <div class="cart-item-controls">
                <button class="btn-minus" data-id="${item.menu_id}">-</button>
                <span class="quantity">${item.quantity}</span>
                <button class="btn-plus" data-id="${item.menu_id}">+</button>
            </div>
        `;
        cartItemsListEl.appendChild(div);
    });
}


// ===========================================
// 7. 주문 전송 (Socket.IO)
// ===========================================

function submitOrder() {
    if (cartSubmitBtn.disabled) return;
    if (boothId === 'N/A') {
        alert('테이블(부스) 번호가 확인되지 않아 주문할 수 없습니다. 다시 로그인해 주세요.');
        return;
    }

    const orderItems = Object.values(cart).map(item => ({
        menu_id: item.menu_id,
        quantity: item.quantity,
        price: item.price // 단가
    }));

    const totalOrderPrice = orderItems.reduce((sum, item) => sum + (item.quantity * item.price), 0);
    
    const confirmation = confirm(`${boothId}번 테이블의 총 ${totalOrderPrice.toLocaleString()}원을 주문하시겠습니까?`);

    if (confirmation) {
        const orderData = {
            booth_id: boothId,
            total_price: totalOrderPrice,
            items: orderItems,
            note: '' 
        };

        socket.emit('submit_order', orderData);
        alert(`테이블 ${boothId}번의 주문이 성공적으로 접수되었습니다! 잠시만 기다려 주세요.`);
        
        // 주문 완료 후 장바구니 초기화
        cart = {};
        updateCartBadge();
        cartViewModal.style.display = 'none';
    }
}


// ===========================================
// 8. 주문 내역 조회 로직
// ===========================================

async function loadOrderHistory() {
    if (boothId === 'N/A') {
        orderHistoryListEl.innerHTML = '<p class="error-text">테이블 번호를 확인할 수 없습니다.</p>';
        return;
    }

    try {
        orderHistoryListEl.innerHTML = '<p class="loading-text" style="text-align: center; color: var(--color-light-gray);">주문 내역을 불러오는 중...</p>';
        const response = await fetch(`/api/orders/${boothId}`);
        if (!response.ok) throw new Error('주문 내역 로드 실패');
        const orders = await response.json();
        renderOrderHistory(orders);
    } catch (error) {
        console.error("주문 내역 로드 실패:", error);
        orderHistoryListEl.innerHTML = '<p class="error-text" style="text-align: center; color: var(--color-secondary);">😭 주문 내역을 불러오는 데 오류가 발생했습니다.</p>';
    }
}

function renderOrderHistory(orders) {
    orderHistoryListEl.innerHTML = ''; 
    if (orders.length === 0) {
        orderHistoryListEl.innerHTML = '<p style="text-align: center; color: var(--color-light-gray);">아직 주문 내역이 없습니다.</p>';
        return;
    }

    orders.forEach(order => {
        const itemsHtml = order.items.map(item => `
            <li>${item.name} x ${item.quantity}</li>
        `).join('');
        
        const statusText = order.status === 'pending' ? '대기 중' : 
                           order.status === 'processing' ? '조리 중' : 
                           '✅ 완료';

        const card = document.createElement('div');
        card.className = 'history-card';
        card.innerHTML = `
            <div class="history-header">
                <span>${order.order_time} 주문</span>
                <span class="history-status status-${order.status}">${statusText}</span>
            </div>
            <ul>${itemsHtml}</ul>
            <p style="font-weight: bold; text-align: right; margin-top: 10px; color: var(--color-secondary);">총 금액: ${order.total_price.toLocaleString()}원</p>
        `;
        orderHistoryListEl.appendChild(card);
    });
}


// ===========================================
// 9. 이벤트 리스너 통합
// ===========================================

// 카테고리 탭 클릭 이벤트
categoryTabsEl.addEventListener('click', (e) => {
    const target = e.target;
    if (target.classList.contains('tab-button')) {
        categoryTabsEl.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        target.classList.add('active');
        filterAndRenderMenus(target.dataset.category);
    }
});

// 메뉴 상세 모달: 수량 조절
modalBtnPlus.addEventListener('click', () => {
    let quantity = parseInt(modalQuantityEl.textContent);
    updateDetailModal(quantity + 1);
});

modalBtnMinus.addEventListener('click', () => {
    let quantity = parseInt(modalQuantityEl.textContent);
    if (quantity > 1) {
        updateDetailModal(quantity - 1);
    }
});

// 메뉴 상세 모달: 담기 버튼
addToCartBtn.addEventListener('click', () => {
    if (!currentDetailMenu) return;
    const quantity = parseInt(addToCartBtn.dataset.quantity);
    
    // 장바구니에 아이템 정보 저장 (이름, 가격 포함)
    cart[currentDetailMenu.menu_id] = {
        menu_id: currentDetailMenu.menu_id,
        name: currentDetailMenu.name,
        price: currentDetailMenu.price,
        quantity: quantity
    };
    
    // alert(`${currentDetailMenu.name} ${quantity}개를 장바구니에 담았습니다.`);
    detailModal.style.display = 'none';
    updateCartBadge();
});

// 장바구니 아이콘 클릭
cartIconEl.addEventListener('click', () => {
    renderCartView();
    cartViewModal.style.display = 'block';
});

// 장바구니 모달: 수량 조절
cartItemsListEl.addEventListener('click', (e) => {
    const target = e.target;
    if (target.classList.contains('btn-plus') || target.classList.contains('btn-minus')) {
        const menuId = parseInt(target.dataset.id);
        const item = cart[menuId];

        if (target.classList.contains('btn-plus')) {
            item.quantity += 1;
        } else if (target.classList.contains('btn-minus') && item.quantity > 1) {
            item.quantity -= 1;
        } else if (target.classList.contains('btn-minus') && item.quantity === 1) {
            if(confirm(`${item.name}을 장바구니에서 제거하시겠습니까?`)) {
                delete cart[menuId];
            }
        }
        
        e.stopPropagation(); 
        
        renderCartView();
        updateCartBadge();

        if (Object.keys(cart).length === 0) {
            // 장바구니가 완전히 비면 모달 닫기
            cartViewModal.style.display = 'none';
        }
    }
});

// 장바구니 모달: 주문하기 버튼
cartSubmitBtn.addEventListener('click', submitOrder);

// 모달 닫기 버튼 이벤트
detailCloseBtn.addEventListener('click', () => detailModal.style.display = 'none');
cartViewCloseBtn.addEventListener('click', () => cartViewModal.style.display = 'none');
historyCloseBtn.addEventListener('click', () => orderHistoryModal.style.display = 'none');

// 테이블 번호 클릭 시 주문 내역 모달 열기
boothNumberEl.addEventListener('click', () => {
    modalBoothIdEl.textContent = boothId;
    orderHistoryModal.style.display = 'block';
    loadOrderHistory(); // 주문 내역 로드 시작
});

// 초기화
getBoothIdFromUrl();
loadMenus();