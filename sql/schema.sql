-- --------------------------------------------------------
-- 0. 외래 키 제약 조건 일시 해제 (순서 문제 방지)
-- --------------------------------------------------------
SET FOREIGN_KEY_CHECKS = 0; 


-- --------------------------------------------------------
-- 1. 테이블 삭제 순서 수정 (의존성: order_items -> orders -> menus)
-- --------------------------------------------------------
DROP TABLE IF EXISTS order_items; -- order_items는 menus와 orders를 참조하므로 가장 먼저 삭제
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS menus;


-- --------------------------------------------------------
-- 2. 메뉴 정보 테이블 (menus)
-- --------------------------------------------------------
CREATE TABLE menus (
    menu_id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    price INT NOT NULL,
    category VARCHAR(50), -- '메인', '사이드'
    description TEXT,
    image_url VARCHAR(255) NULL -- 메뉴 이미지 경로 (선택 사항)
);

-- --------------------------------------------------------
-- 3. 주문 정보 테이블 (orders)
-- 💡 server.js의 submit_order 이벤트 핸들러에 맞게 컬럼 추가됨:
--    payment_status, note
-- --------------------------------------------------------
CREATE TABLE orders (
    order_id INT PRIMARY KEY AUTO_INCREMENT,
    booth_id VARCHAR(10) NOT NULL, -- QR 스캔을 통해 받은 부스/테이블 번호
    order_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status ENUM('pending', 'processing', 'completed') NOT NULL DEFAULT 'pending', -- '대기', '조리 중', '완료(서빙)'
    
    -- 💡 추가됨: 결제 상태 추적 (server.js의 submit_order 로직에 필요)
    payment_status ENUM('paid', 'unpaid', 'cancelled') NOT NULL DEFAULT 'unpaid', 
    
    total_price INT NOT NULL, -- 총 결제 금액
    note VARCHAR(255) NULL -- 요청사항 등
);

-- --------------------------------------------------------
-- 4. 주문 상세 테이블 (order_items)
-- 💡 server.js의 submit_order 로직에 맞게 unit_price 컬럼 추가됨
-- --------------------------------------------------------
-- order_items 테이블 정의 (예시)
CREATE TABLE IF NOT EXISTS order_items (
    item_id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT,
    menu_id INT,
    quantity INT NOT NULL,
    unit_price INT NOT NULL,
    -- 🚨 여기에 item_status 컬럼 추가 🚨
    item_status ENUM('processing', 'cooking', 'ready_to_serve', 'served', 'cancelled') NOT NULL DEFAULT 'processing', 
    FOREIGN KEY (order_id) REFERENCES orders(order_id),
    FOREIGN KEY (menu_id) REFERENCES menus(menu_id)
);


-- --------------------------------------------------------
-- 5. 외래 키 제약 조건 다시 활성화
-- --------------------------------------------------------
SET FOREIGN_KEY_CHECKS = 1;

-- --------------------------------------------------------
-- 6. 초기 메뉴 데이터 삽입
-- --------------------------------------------------------

INSERT INTO menus (menu_id, name, price, category, description, image_url) VALUES
(1, '렌고쿠의 불꽃 숨결(제육볶음)', 12900, '메인', '불의 호흡을 계승한 렌고쿠처럼 강렬하게 불타오르는 제육볶음. 한 입 먹는 순간 입안 속에서 타오르는 화염의 매운맛을 느낄 수 있습니다.', 'j.png'),
(2, '꺽쇠 까마귀 발', 14900, '메인', '귀살대원 곁을 지키는 꺽쇠 까마귀의 날카로운 발톱을 닮은 닭발! 매콤하고 중독적인 맛이 집요하게 당신을 붙잡아, 숟가락을 멈출 수 없게 만듭니다.', 'd.png'),
(3, '네즈코의 치유 한 입', 3500, '사이드', '전투로 지친 몸을 따뜻하게 위로해줄 네즈코의 다정한 한 입. 부드럽고 담백한 주먹밥이 당신의 기운을 되살려줄 것입니다.', 'b.png'),
(4, '아카자의 눈물', 5000, '사이드', '아카자가 인간 하쿠지로 변하면서 흘린 눈물이 굳어져 만들어진 한 조각. 치즈와 고소한 토핑이 어우러져, 아픈 과거와 함께 쓸쓸하면서도 깊은 여운을 전합니다.', 'p.png'),
(5, '이노스케의 야생 옥수수', 5000, '사이드', '숲 속을 뛰어다니던 이노스케가 직접 따서 즐겨 먹던 음식. 달콤한 옥수수와 고소한 치즈가 어우러져 야생의 자유로움을 그대로 전합니다.', 'c.png');