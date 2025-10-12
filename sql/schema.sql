-- --------------------------------------------------------
-- 1. 메뉴 정보 테이블 (menus)
-- 고객 주문 페이지에 표시될 메뉴의 마스터 데이터입니다.
-- --------------------------------------------------------
DROP TABLE IF EXISTS menus;
CREATE TABLE menus (
    menu_id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    price INT NOT NULL,
    category VARCHAR(50), -- '메인', '사이드'
    description TEXT,
    image_url VARCHAR(255) NULL -- 메뉴 이미지 경로 (선택 사항)
);

-- --------------------------------------------------------
-- 2. 주문 정보 테이블 (orders)
-- 부스 번호, 주문 시간, 현재 상태 등 주문의 기본 정보를 저장합니다.
-- --------------------------------------------------------
DROP TABLE IF EXISTS orders;
CREATE TABLE orders (
    order_id INT PRIMARY KEY AUTO_INCREMENT,
    booth_id VARCHAR(10) NOT NULL, -- QR 스캔을 통해 받은 부스/테이블 번호
    order_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status ENUM('pending', 'processing', 'completed') NOT NULL DEFAULT 'pending', -- '대기', '조리 중', '완료(서빙)'
    total_price INT NOT NULL, -- 총 결제 금액
    note VARCHAR(255) NULL -- 요청사항 등
);

-- --------------------------------------------------------
-- 3. 주문 상세 테이블 (order_items)
-- 각 주문(orders)이 어떤 메뉴(menus)와 수량으로 구성되어 있는지 상세 내역을 저장합니다.
-- --------------------------------------------------------
DROP TABLE IF EXISTS order_items;
CREATE TABLE order_items (
    item_id INT PRIMARY KEY AUTO_INCREMENT,
    order_id INT NOT NULL,
    menu_id INT NOT NULL,
    quantity INT NOT NULL,

    -- 외래 키 설정: 주문 ID는 orders 테이블을 참조
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
    -- 외래 키 설정: 메뉴 ID는 menus 테이블을 참조
    FOREIGN KEY (menu_id) REFERENCES menus(menu_id)
);

-- --------------------------------------------------------
-- 4. 초기 메뉴 데이터 삽입
-- 제공된 메뉴판 정보를 기반으로 메뉴 마스터 데이터를 미리 채워 넣습니다.
-- --------------------------------------------------------

INSERT INTO menus (menu_id, name, price, category, description, image_url) VALUES
(1, '렌고쿠의 불꽃 숨결(제육볶음)', 12900, '메인', '불의 호흡을 계승한 렌고쿠처럼 강렬하게 불타오르는 제육볶음. 한 입 먹는 순간 입안 속에서 타오르는 화염의 매운맛을 느낄 수 있습니다.', '제육볶음.png'),
(2, '꺽쇠 까마귀 발', 14900, '메인', '귀살대원 곁을 지키는 꺽쇠 까마귀의 날카로운 발톱을 닮은 닭발! 매콤하고 중독적인 맛이 집요하게 당신을 붙잡아, 숟가락을 멈출 수 없게 만듭니다.', '닭발.png'),
(3, '네즈코의 치유 한 입', 3500, '사이드', '전투로 지친 몸을 따뜻하게 위로해줄 네즈코의 다정한 한 입. 부드럽고 담백한 주먹밥이 당신의 기운을 되살려줄 것입니다.', '주먹밥.png'),
(4, '아카자의 눈물', 5000, '사이드', '아카자가 인간 하쿠지로 변하면서 흘린 눈물이 굳어져 만들어진 한 조각. 치즈와 고소한 토핑이 어우러져, 아픈 과거와 함께 쓸쓸하면서도 깊은 여운을 전합니다.', '포카칩피자.png'),
(5, '이노스케의 야생 옥수수', 5000, '사이드', '숲 속을 뛰어다니던 이노스케가 직접 따서 즐겨 먹던 음식. 달콤한 옥수수와 고소한 치즈가 어우러져 야생의 자유로움을 그대로 전합니다.', '콘치즈.png');

-- DB 서버에 따라 "냥" 화폐 단위를 위해 가격을 INT로 저장했으며,
-- `image_url`은 `public/assets/` 폴더 내에 이미지 파일을 두었다고 가정했습니다.