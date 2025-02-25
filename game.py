import pygame
import math
import random
import sys

# ---------------------------------
# 폰트 깨짐 방지(윈도우 'malgungothic' 사용)
# ---------------------------------
pygame.init()
try:
    FONT_NAME = "malgungothic"
    # 혹은 폰트 파일 직접 지정 가능: pygame.font.Font("malgun.ttf", size)
except:
    # 말굿고딕 폰트가 없으면 기본 폰트로 fallback
    FONT_NAME = None

# ---------------------------------
# 해상도 & 맵 크기
# ---------------------------------
SCREEN_WIDTH = 1920
SCREEN_HEIGHT = 1080
MAP_WIDTH = 16000
MAP_HEIGHT = 16000

# ---------------------------------
# 전역 설정
# ---------------------------------
screen = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT))
pygame.display.set_caption("풍선 터뜨리기")
clock = pygame.time.Clock()

# 색상
WHITE = (255, 255, 255)
BLACK = (0, 0, 0)
GRAY = (200, 200, 200)
DARK_GRAY = (100, 100, 100)
RED = (255, 0, 0)
YELLOW = (255, 200, 0)
BLUE = (0, 150, 255)
GREEN = (0, 255, 0)
ORANGE = (255, 165, 0)
PURPLE = (128, 0, 128)

# 폰트
font_small = pygame.font.SysFont(FONT_NAME, 24)
font_medium = pygame.font.SysFont(FONT_NAME, 36)
font_big = pygame.font.SysFont(FONT_NAME, 60)

# 플레이어 & NPC 속성
PLAYER_RADIUS = 30
BALLOON_RADIUS = 36  # 풍선 크기 (기존 12 -> 3배)
ARROW_OFFSET = PLAYER_RADIUS + 10  # 플레이어 원 밖으로 송곳이 보이게
ARROW_LENGTH = 30
NPC_RADIUS = 40

# 가속 / 속도 / 마찰
ACCELERATION = 1.0      # 왼쪽 마우스 누를 때 가속량
FRICTION = 0.98         # 매 프레임 속도 감소율
MAX_SPEED = 25.0 * 5.0  # 기존 속도의 5배 → 25였는데, 문제에서 “5배 더 빨라” 언급 → 25*5 = 125?
                        # 사용자 취향에 맞게 조정 가능
TURN_DIFFICULTY = 0.2   # 속도가 빠를 때 방향 전환이 어려워지도록(미끄러짐) 적용할 계수

NPC_SPEED = 2.0         # NPC 추적 속도(상대적으로 느리게)

# ---------------------------------
# Player 클래스 (한 컴퓨터당 1명)
# ---------------------------------
class Player:
    def __init__(self, nickname="Player", color=BLUE, x=100, y=100):
        self.nickname = nickname
        self.color = color
        self.x = float(x)
        self.y = float(y)
        self.vx = 0.0
        self.vy = 0.0
        self.alive = True

    def update(self, mouse_pressed, mouse_pos):
        if not self.alive:
            return

        # 1) 마우스 각도 구하기 (arrow 방향)
        dx = mouse_pos[0] - (SCREEN_WIDTH // 2)  # 플레이어는 화면 중앙에 고정 -> 카메라 오프셋 없이 중앙 기준
        dy = mouse_pos[1] - (SCREEN_HEIGHT // 2)
        angle = math.atan2(dy, dx)  # 라디안 값

        # 2) 가속 (왼쪽 마우스 눌린 상태) -> velocity에 더해준다
        if mouse_pressed[0]:  # 0번 인덱스: 왼쪽 버튼
            # 속도가 높을수록 방향 변화가 어려워지도록(미끄러짐):
            # 방법1: 현재 속도 벡터를 조금씩 타겟 각도로 보정
            speed_factor = 1.0 - (math.hypot(self.vx, self.vy) / MAX_SPEED) * TURN_DIFFICULTY
            speed_factor = max(0.0, speed_factor)  # 음수 방지
            # 목표 가속 벡터
            ax = ACCELERATION * math.cos(angle)
            ay = ACCELERATION * math.sin(angle)
            # 실제로는 speed_factor만큼만 방향 반영
            self.vx += ax * speed_factor
            self.vy += ay * speed_factor

        # 3) 마찰(속도 감소) 처리
        self.vx *= FRICTION
        self.vy *= FRICTION

        # 4) 최대 속도 제한
        speed = math.hypot(self.vx, self.vy)
        if speed > MAX_SPEED:
            scale = MAX_SPEED / speed
            self.vx *= scale
            self.vy *= scale

        # 5) 좌표 업데이트
        self.x += self.vx
        self.y += self.vy

        # 맵 경계 처리
        if self.x < PLAYER_RADIUS:
            self.x = PLAYER_RADIUS
            self.vx = 0
        if self.x > MAP_WIDTH - PLAYER_RADIUS:
            self.x = MAP_WIDTH - PLAYER_RADIUS
            self.vx = 0
        if self.y < PLAYER_RADIUS:
            self.y = PLAYER_RADIUS
            self.vy = 0
        if self.y > MAP_HEIGHT - PLAYER_RADIUS:
            self.y = MAP_HEIGHT - PLAYER_RADIUS
            self.vy = 0

    def draw(self, surface, camera_x, camera_y, mouse_pos):
        if not self.alive:
            return

        # 화면상의 그릴 좌표
        draw_x = int(self.x - camera_x)
        draw_y = int(self.y - camera_y)

        # 중심 원(플레이어)
        pygame.draw.circle(surface, self.color, (draw_x, draw_y), PLAYER_RADIUS)

        # 마우스 각도 (arrow 방향)
        # 여기서는 화면 중앙에 플레이어가 있으므로, 
        # 플레이어 기준: (SCREEN_WIDTH//2, SCREEN_HEIGHT//2)
        # 하지만 실제 draw_x, draw_y != SCREEN 중심일 수 있음(카메라 위치에 따라)
        # → 간단히 "플레이어→마우스" 각도를 재계산
        dx = mouse_pos[0] - (SCREEN_WIDTH // 2)
        dy = mouse_pos[1] - (SCREEN_HEIGHT // 2)
        angle = math.atan2(dy, dx)

        # 송곳 tip 위치
        tip_offset = ARROW_OFFSET + ARROW_LENGTH
        tip_x = draw_x + tip_offset * math.cos(angle)
        tip_y = draw_y + tip_offset * math.sin(angle)

        # 삼각형 양옆
        arrow_wing = 10
        left_x = draw_x + (ARROW_OFFSET + arrow_wing) * math.cos(angle + math.pi * 2/3)
        left_y = draw_y + (ARROW_OFFSET + arrow_wing) * math.sin(angle + math.pi * 2/3)
        right_x = draw_x + (ARROW_OFFSET + arrow_wing) * math.cos(angle - math.pi * 2/3)
        right_y = draw_y + (ARROW_OFFSET + arrow_wing) * math.sin(angle - math.pi * 2/3)

        pygame.draw.polygon(surface, RED, [(tip_x, tip_y), (left_x, left_y), (right_x, right_y)])

        # 풍선 (플레이어 뒤)
        # 플레이어 원 반대편 방향에 떨어뜨림
        balloon_offset = ARROW_OFFSET + 10
        balloon_x = draw_x - balloon_offset * math.cos(angle)
        balloon_y = draw_y - balloon_offset * math.sin(angle)
        pygame.draw.circle(surface, YELLOW, (int(balloon_x), int(balloon_y)), BALLOON_RADIUS)

        # 닉네임
        text_surf = font_small.render(self.nickname, True, BLACK)
        surface.blit(text_surf, (draw_x - text_surf.get_width() // 2,
                                 draw_y - PLAYER_RADIUS - 30))

# ---------------------------------
# AI 플레이어 (여러 명 넣어 충돌 테스트용, 랜덤 이동)
# ---------------------------------
class AIPlayer:
    def __init__(self, nickname="AI", color=GREEN):
        self.nickname = nickname
        self.color = color
        self.x = float(random.randint(PLAYER_RADIUS, MAP_WIDTH - PLAYER_RADIUS))
        self.y = float(random.randint(PLAYER_RADIUS, MAP_HEIGHT - PLAYER_RADIUS))
        self.vx = random.uniform(-5, 5)
        self.vy = random.uniform(-5, 5)
        self.alive = True

    def update(self):
        if not self.alive:
            return

        # 랜덤하게 조금씩 방향 변경
        if random.random() < 0.02:
            self.vx += random.uniform(-3, 3)
            self.vy += random.uniform(-3, 3)

        # 마찰
        self.vx *= 0.95
        self.vy *= 0.95

        # 속도 제한
        spd = math.hypot(self.vx, self.vy)
        if spd > 15:
            scale = 15 / spd
            self.vx *= scale
            self.vy *= scale

        # 이동
        self.x += self.vx
        self.y += self.vy

        # 맵 경계
        if self.x < PLAYER_RADIUS:
            self.x = PLAYER_RADIUS
            self.vx = -self.vx
        if self.x > MAP_WIDTH - PLAYER_RADIUS:
            self.x = MAP_WIDTH - PLAYER_RADIUS
            self.vx = -self.vx
        if self.y < PLAYER_RADIUS:
            self.y = PLAYER_RADIUS
            self.vy = -self.vy
        if self.y > MAP_HEIGHT - PLAYER_RADIUS:
            self.y = MAP_HEIGHT - PLAYER_RADIUS
            self.vy = -self.vy

    def draw(self, surface, camera_x, camera_y):
        if not self.alive:
            return

        draw_x = int(self.x - camera_x)
        draw_y = int(self.y - camera_y)
        pygame.draw.circle(surface, self.color, (draw_x, draw_y), PLAYER_RADIUS)

        # 풍선 (단순 뒤쪽?) -> AI는 각도가 없으니 대충 y축 위로
        balloon_y = draw_y - (PLAYER_RADIUS + 15)
        pygame.draw.circle(surface, YELLOW, (draw_x, balloon_y), BALLOON_RADIUS)

        text_surf = font_small.render(self.nickname, True, BLACK)
        surface.blit(text_surf, (draw_x - text_surf.get_width() // 2,
                                 draw_y - PLAYER_RADIUS - 30))

# ---------------------------------
# NPC (가장 가까운 플레이어 추적)
# ---------------------------------
class NPC:
    def __init__(self):
        self.x = float(random.randint(NPC_RADIUS, MAP_WIDTH - NPC_RADIUS))
        self.y = float(random.randint(NPC_RADIUS, MAP_HEIGHT - NPC_RADIUS))
        self.vx = 0.0
        self.vy = 0.0
        self.speed = NPC_SPEED

    def update(self, players):
        # 가장 가까운 살아있는 플레이어 찾기
        alive_players = [p for p in players if p.alive]
        if not alive_players:
            return

        closest_p = None
        closest_dist = float('inf')
        for p in alive_players:
            dx = p.x - self.x
            dy = p.y - self.y
            dist_sq = dx*dx + dy*dy
            if dist_sq < closest_dist:
                closest_dist = dist_sq
                closest_p = p

        if closest_p:
            dx = closest_p.x - self.x
            dy = closest_p.y - self.y
            dist = math.hypot(dx, dy)
            if dist != 0:
                self.vx = (dx / dist) * self.speed
                self.vy = (dy / dist) * self.speed

        self.x += self.vx
        self.y += self.vy

        # 맵 경계
        if self.x < NPC_RADIUS:
            self.x = NPC_RADIUS
            self.vx = 0
        if self.x > MAP_WIDTH - NPC_RADIUS:
            self.x = MAP_WIDTH - NPC_RADIUS
            self.vx = 0
        if self.y < NPC_RADIUS:
            self.y = NPC_RADIUS
            self.vy = 0
        if self.y > MAP_HEIGHT - NPC_RADIUS:
            self.y = MAP_HEIGHT - NPC_RADIUS
            self.vy = 0

    def draw(self, surface, camera_x, camera_y):
        draw_x = int(self.x - camera_x)
        draw_y = int(self.y - camera_y)
        pygame.draw.circle(surface, BLACK, (draw_x, draw_y), NPC_RADIUS)

# ---------------------------------
# 충돌 체크 함수
#   "화살표 tip" -> "상대 풍선" 만 체크
# ---------------------------------
def check_arrow_hits_balloon(attacker, defender, camera_x, camera_y, mouse_pos):
    """
    attacker: Player(또는 AI) - 화살표가 있는 주체
    defender: Player(또는 AI) - 풍선을 가진 객체
    mouse_pos: 공격자(플레이어)일 경우 마우스로 각도 계산
               AI의 경우 각도 없으니 대충 처리 (이 예시엔 AI끼리 공격 x)
    """
    if not (attacker.alive and defender.alive):
        return False

    # attacker가 Player인지 AI인지에 따라 arrow angle 계산
    if isinstance(attacker, Player):
        # 플레이어는 마우스로 각도 계산
        dx = mouse_pos[0] - (SCREEN_WIDTH // 2)
        dy = mouse_pos[1] - (SCREEN_HEIGHT // 2)
        angle = math.atan2(dy, dx)
    else:
        # AI -> 화살표 각도 없음. 여기서는 공격 기능이 없다고 가정.
        return False

    # arrow tip (맵좌표)
    tip_offset = ARROW_OFFSET + ARROW_LENGTH
    tip_x = attacker.x + tip_offset * math.cos(angle)
    tip_y = attacker.y + tip_offset * math.sin(angle)

    # defender 풍선 중심 (맵좌표)
    # defender가 Player인지 AI인지에 따라 "풍선 위치"가 다를 수 있음
    # 여기서는 Player는 마우스로 향하지만, AI는 임의로 위쪽에 풍선이 있다고 설정
    if isinstance(defender, Player):
        # defender도 마우스로 각도? -> 같은 이슈. 
        # 하지만 자기 각도는 자기 마우스라서 충돌판정이 복잡.
        # 여기서는 "player 풍선 = player 본체 뒤쪽"이므로
        # attacker->defender(플레이어) 각도 = ?
        # 간단화: 풍선은 defender.x, defender.y에서 angle 반대편
        # 실제 게임이라면 defender 자신이 가진 angle로 계산해야 하나, 
        # 여기서는 대충 "마우스와 반대편"이라 가정.
        d_dx = (attacker.x - defender.x)
        d_dy = (attacker.y - defender.y)
        # 방어자의 풍선 각도(공격자와 반대 방향)
        d_angle = math.atan2(d_dy, d_dx)
        balloon_offset = PLAYER_RADIUS + 10
        balloon_x = defender.x - balloon_offset * math.cos(d_angle)
        balloon_y = defender.y - balloon_offset * math.sin(d_angle)
        balloon_r = BALLOON_RADIUS

    else:  # AIPlayer
        # 이미 draw에서 위쪽에 풍선이 있다고 했으므로, 단순히 defender.y - (PLAYER_RADIUS+15)
        balloon_x = defender.x
        balloon_y = defender.y - (PLAYER_RADIUS + 15)
        balloon_r = BALLOON_RADIUS

    dist = math.hypot(tip_x - balloon_x, tip_y - balloon_y)
    return (dist < balloon_r)

# ---------------------------------
# 격자무늬 배경 그리기
# ---------------------------------
def draw_grid(surface, camera_x, camera_y):
    # 먼저 흰색으로 지우고
    surface.fill(WHITE)

    # 일정 간격으로 선 긋기 (예: 200픽셀)
    grid_gap = 200

    # 카메라를 고려해 실제 맵에서 그릴 선의 시작/끝을 구한다
    # 수평선(y고정), 수직선(x고정)
    # 화면에 보이는 부분만 그려도 됨

    # 맵 전체에 선을 긋고, 카메라 만큼 좌표를 뺀다.
    # 수직선
    start_x = (camera_x // grid_gap) * grid_gap
    end_x = ((camera_x + SCREEN_WIDTH) // grid_gap + 1) * grid_gap
    for x in range(int(start_x), int(end_x), grid_gap):
        draw_x = x - camera_x
        pygame.draw.line(surface, DARK_GRAY, (draw_x, 0), (draw_x, SCREEN_HEIGHT), 1)

    # 수평선
    start_y = (camera_y // grid_gap) * grid_gap
    end_y = ((camera_y + SCREEN_HEIGHT) // grid_gap + 1) * grid_gap
    for y in range(int(start_y), int(end_y), grid_gap):
        draw_y = y - camera_y
        pygame.draw.line(surface, DARK_GRAY, (0, draw_y), (SCREEN_WIDTH, draw_y), 1)

# ---------------------------------
# 간단 버튼 클릭 판정
# ---------------------------------
def is_button_clicked(rect, mouse_pos):
    return rect.collidepoint(mouse_pos)

# ---------------------------------
# 메인 메뉴
# ---------------------------------
def main_menu():
    start_button = pygame.Rect(SCREEN_WIDTH//2 - 100, SCREEN_HEIGHT//2 - 60, 200, 50)
    exit_button = pygame.Rect(SCREEN_WIDTH//2 - 100, SCREEN_HEIGHT//2 + 20, 200, 50)

    while True:
        clock.tick(60)
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                pygame.quit()
                sys.exit()
            elif event.type == pygame.MOUSEBUTTONDOWN and event.button == 1:
                if is_button_clicked(start_button, event.pos):
                    return  # main_menu 탈출 → 로비로
                if is_button_clicked(exit_button, event.pos):
                    pygame.quit()
                    sys.exit()

        screen.fill(WHITE)
        title_text = font_big.render("풍선 터뜨리기", True, BLACK)
        screen.blit(title_text, (SCREEN_WIDTH//2 - title_text.get_width()//2, SCREEN_HEIGHT//2 - 200))

        pygame.draw.rect(screen, GRAY, start_button)
        start_text = font_medium.render("Start", True, BLACK)
        screen.blit(start_text, (start_button.centerx - start_text.get_width()//2,
                                 start_button.centery - start_text.get_height()//2))

        pygame.draw.rect(screen, GRAY, exit_button)
        exit_text = font_medium.render("Exit", True, BLACK)
        screen.blit(exit_text, (exit_button.centerx - exit_text.get_width()//2,
                                exit_button.centery - exit_text.get_height()//2))

        pygame.display.flip()

# ---------------------------------
# 로비: 플레이어 닉네임, 색상 선택
# ---------------------------------
def lobby():
    input_box = pygame.Rect(SCREEN_WIDTH//2 - 100, SCREEN_HEIGHT//2 - 100, 200, 40)
    color_candidates = [BLUE, RED, GREEN, ORANGE, PURPLE]
    color_index = 0
    confirm_button = pygame.Rect(SCREEN_WIDTH//2 - 100, SCREEN_HEIGHT//2 + 20, 200, 50)

    nickname = ""
    active = False

    while True:
        clock.tick(60)
        mouse_pos = pygame.mouse.get_pos()
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                pygame.quit()
                sys.exit()
            elif event.type == pygame.MOUSEBUTTONDOWN:
                if input_box.collidepoint(event.pos):
                    active = True
                else:
                    active = False

                # 색상 화살표
                left_arrow = pygame.Rect(input_box.left - 50, input_box.centery - 15, 30, 30)
                right_arrow = pygame.Rect(input_box.right + 20, input_box.centery - 15, 30, 30)
                if left_arrow.collidepoint(event.pos):
                    color_index = (color_index - 1) % len(color_candidates)
                elif right_arrow.collidepoint(event.pos):
                    color_index = (color_index + 1) % len(color_candidates)

                # 확인 버튼
                if confirm_button.collidepoint(event.pos):
                    if nickname.strip() == "":
                        nickname = "Player"
                    return nickname, color_candidates[color_index]

            elif event.type == pygame.KEYDOWN:
                if active:
                    if event.key == pygame.K_BACKSPACE:
                        nickname = nickname[:-1]
                    else:
                        nickname += event.unicode

        screen.fill(WHITE)
        title_text = font_big.render("플레이어 정보 입력", True, BLACK)
        screen.blit(title_text, (SCREEN_WIDTH//2 - title_text.get_width()//2, 150))

        # 입력 박스
        pygame.draw.rect(screen, (230,230,230) if active else GRAY, input_box, border_radius=5)
        nick_surf = font_medium.render(nickname, True, BLACK)
        screen.blit(nick_surf, (input_box.x+5, input_box.y + (input_box.height - nick_surf.get_height())//2))

        # 색상 미리보기
        color_rect = pygame.Rect(input_box.centerx - 15, input_box.top - 60, 30, 30)
        pygame.draw.rect(screen, color_candidates[color_index], color_rect)

        # 화살표 버튼
        left_arrow = pygame.Rect(input_box.left - 50, input_box.centery - 15, 30, 30)
        right_arrow = pygame.Rect(input_box.right + 20, input_box.centery - 15, 30, 30)
        pygame.draw.rect(screen, GRAY, left_arrow)
        pygame.draw.rect(screen, GRAY, right_arrow)
        arrow_left_text = font_medium.render("<", True, BLACK)
        arrow_right_text = font_medium.render(">", True, BLACK)
        screen.blit(arrow_left_text, (left_arrow.centerx - arrow_left_text.get_width()//2,
                                      left_arrow.centery - arrow_left_text.get_height()//2))
        screen.blit(arrow_right_text, (right_arrow.centerx - arrow_right_text.get_width()//2,
                                       right_arrow.centery - arrow_right_text.get_height()//2))

        # 확인 버튼
        pygame.draw.rect(screen, GRAY, confirm_button)
        confirm_text = font_medium.render("확인", True, BLACK)
        screen.blit(confirm_text, (confirm_button.centerx - confirm_text.get_width()//2,
                                   confirm_button.centery - confirm_text.get_height()//2))

        pygame.display.flip()

# ---------------------------------
# 게임 종료 화면 (승자 표시 후 OK 누르면 메인메뉴)
# ---------------------------------
def end_game(winner_name):
    ok_button = pygame.Rect(SCREEN_WIDTH//2 - 100, SCREEN_HEIGHT//2 + 50, 200, 50)

    while True:
        clock.tick(60)
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                pygame.quit()
                sys.exit()
            elif event.type == pygame.MOUSEBUTTONDOWN and event.button == 1:
                if ok_button.collidepoint(event.pos):
                    return  # 메인메뉴로 돌아가기

        screen.fill(WHITE)
        win_text = font_big.render(f"{winner_name} WIN!", True, BLACK)
        screen.blit(win_text, (SCREEN_WIDTH//2 - win_text.get_width()//2, SCREEN_HEIGHT//2 - 100))

        pygame.draw.rect(screen, GRAY, ok_button)
        ok_text = font_medium.render("OK", True, BLACK)
        screen.blit(ok_text, (ok_button.centerx - ok_text.get_width()//2,
                              ok_button.centery - ok_text.get_height()//2))

        pygame.display.flip()

# ---------------------------------
# 실제 게임 루프
# ---------------------------------
def game_loop(nickname, color):
    # 로컬 플레이어 1명
    player = Player(nickname=nickname, color=color, x=8000, y=8000)  # 맵 중앙 근처

    # AI 플레이어 2명 (충돌 테스트용)
    ais = [AIPlayer(nickname=f"AI_{i}", color=(random.randint(0,255), random.randint(0,255), random.randint(0,255))) 
           for i in range(2)]

    # NPC 2마리
    npcs = [NPC() for _ in range(2)]

    running = True
    while running:
        clock.tick(60)
        mouse_pos = pygame.mouse.get_pos()
        mouse_pressed = pygame.mouse.get_pressed()  # (left, middle, right) boolean tuple

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                pygame.quit()
                sys.exit()

        # 업데이트
        player.update(mouse_pressed, mouse_pos)
        for ai in ais:
            ai.update()
        for npc in npcs:
            npc.update([player] + ais)

        # 카메라(플레이어를 화면 중앙에 고정)
        camera_x = player.x - SCREEN_WIDTH // 2
        camera_y = player.y - SCREEN_HEIGHT // 2
        # 맵 경계에 맞춰 조정
        if camera_x < 0:
            camera_x = 0
        if camera_y < 0:
            camera_y = 0
        if camera_x > MAP_WIDTH - SCREEN_WIDTH:
            camera_x = MAP_WIDTH - SCREEN_WIDTH
        if camera_y > MAP_HEIGHT - SCREEN_HEIGHT:
            camera_y = MAP_HEIGHT - SCREEN_HEIGHT

        # 충돌 체크
        # "arrow tip" vs "다른 플레이어 풍선"  
        # player -> AI 풍선
        for ai in ais:
            if check_arrow_hits_balloon(player, ai, camera_x, camera_y, mouse_pos):
                ai.alive = False

        # AI들끼리는 공격 로직 없음(원하면 추가)
        # AI -> player 풍선 (예시로 AI는 공격 안한다고 가정)

        # NPC vs player / AI => 기존에는 NPC가 닿으면 아웃이었지만,
        # 문제에서 "화살표 vs 풍선"으로만 처리하라고 했으므로
        # NPC 충돌은 제외할 수도 있음. 필요하면 추가.

        # 플레이어가 살아 있는지, AI가 몇 명 살아있는지에 따라 승자 판정
        all_players = [player] + ais
        alive_players = [p for p in all_players if p.alive]
        if len(alive_players) == 1:
            # 승자 결정
            winner = alive_players[0]
            running = False
            end_game(winner.nickname)
            return  # 메인 메뉴로 돌아감
        if len(alive_players) == 0:
            # 아무도 없음 = 무승부
            running = False
            end_game("NO ONE")
            return

        # 그리기
        draw_grid(screen, camera_x, camera_y)  # 격자무늬 배경
        # NPC
        for npc in npcs:
            npc.draw(screen, camera_x, camera_y)
        # AI
        for ai in ais:
            ai.draw(screen, camera_x, camera_y)
        # Player
        player.draw(screen, camera_x, camera_y, mouse_pos)

        # 우측 하단 미니맵 복구
        mini_map_size = 200
        mini_map_rect = pygame.Rect(SCREEN_WIDTH - mini_map_size - 20, SCREEN_HEIGHT - mini_map_size - 20,
                                    mini_map_size, mini_map_size)
        pygame.draw.rect(screen, (230,230,230), mini_map_rect)
        pygame.draw.rect(screen, DARK_GRAY, mini_map_rect, 2)

        # 맵 -> 미니맵 비율
        scale_x = mini_map_size / MAP_WIDTH
        scale_y = mini_map_size / MAP_HEIGHT

        # 로컬 플레이어
        if player.alive:
            mx = mini_map_rect.left + player.x * scale_x
            my = mini_map_rect.top + player.y * scale_y
            pygame.draw.circle(screen, player.color, (int(mx), int(my)), 3)

        # AI
        for ai in ais:
            if ai.alive:
                mx = mini_map_rect.left + ai.x * scale_x
                my = mini_map_rect.top + ai.y * scale_y
                pygame.draw.circle(screen, ai.color, (int(mx), int(my)), 3)

        # NPC
        for npc in npcs:
            mx = mini_map_rect.left + npc.x * scale_x
            my = mini_map_rect.top + npc.y * scale_y
            pygame.draw.circle(screen, BLACK, (int(mx), int(my)), 4)

        # 생존자 표시 (여기서는 "승리자"라는 개념으로 바꿔달라고 했지만,
        # 게임 중에는 "남은 사람" 표시만 하고, 최후 1인 남았을 때 WIN 처리)
        info_text = font_medium.render(f"생존자: {len(alive_players)}", True, BLACK)
        screen.blit(info_text, (20, 20))

        pygame.display.flip()

# ---------------------------------
# 메인
# ---------------------------------
def main():
    while True:
        # 1) 메인 메뉴
        main_menu()
        # 2) 로비 (닉네임, 색상)
        nick, color = lobby()
        # 3) 게임 시작
        game_loop(nick, color)
        # 게임 끝나면 다시 메인 메뉴로 루프

if __name__ == "__main__":
    main()
