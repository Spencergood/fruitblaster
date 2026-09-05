import Phaser from "phaser";
import { Sfx } from "./audio";
import { buildLevel } from "./levels";
import { Habitat, preloadHabitat } from "./habitat";
import { loadPetSession, PetSessionState, progressPetsForCompletedLevel, SPECIES_NAMES } from "./pets";
import {
  BALL_RADIUS,
  BASE_PADDLE_WIDTH,
  COLORS,
  FIELD_BOTTOM,
  FONT,
  FRUIT_SOURCE_SIZE,
  HEIGHT,
  PADDLE_HEIGHT,
  PADDLE_Y,
  POWERS,
  PowerKind,
  WIDE_PADDLE_WIDTH,
  WIDTH,
} from "./theme";
import { BRICK_W, createTextures } from "./textures";

const BEST_KEY = "fruitblaster:best:v1";

/** Underside of the HUD band. The ball bounces here so it is never hidden. */
const CEILING = 84;
const GRID_TOP = 118;
const ROW_HEIGHT = 40;
const BRICK_GAP = 8;
const EFFECT_MS = 12000;
const TRAIL_POINTS = 9;
const MAX_BALLS = 8;

type BrickData = {
  hp: number;
  power?: PowerKind;
};

type Chip = {
  kind: PowerKind;
  container: Phaser.GameObjects.Container;
  bar: Phaser.GameObjects.Rectangle;
  barWidth: number;
};

class GameScene extends Phaser.Scene {
  private paddle!: Phaser.GameObjects.Image;
  private balls!: Phaser.Physics.Arcade.Group;
  private bricks!: Phaser.Physics.Arcade.StaticGroup;
  private drops!: Phaser.Physics.Arcade.Group;
  private decorations!: Phaser.GameObjects.Group;

  private shardBurst!: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparkBurst!: Phaser.GameObjects.Particles.ParticleEmitter;
  private trailGfx!: Phaser.GameObjects.Graphics;
  private aimGfx!: Phaser.GameObjects.Graphics;
  private floorGlow!: Phaser.GameObjects.Rectangle;
  private scrim!: Phaser.GameObjects.Rectangle;
  private motes: Phaser.GameObjects.Image[] = [];

  private scoreText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private bannerText!: Phaser.GameObjects.Text;
  private subBannerText!: Phaser.GameObjects.Text;
  private pauseText!: Phaser.GameObjects.Text;
  private muteText!: Phaser.GameObjects.Text;
  private lifeIcons: Phaser.GameObjects.Image[] = [];
  private habitat!: Habitat;

  private sfx!: Sfx;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;

  private score = 0;
  private shownScore = 0;
  private best = 0;
  private lives = 3;
  private level = 1;
  private combo = 0;
  private brickTotal = 1;
  private explosiveHits = 0;
  private launched = false;
  private gameOver = false;
  private gameOverAt = 0;
  private paused = false;
  private transitioning = false;
  private beatBest = false;

  private paddleTurbo = false;
  private timedEffects = new Map<PowerKind, Phaser.Time.TimerEvent>();
  private chips = new Map<PowerKind, Chip>();
  private pets: PetSessionState = { completedLevels: 0, pets: [] };

  constructor() {
    super("game");
  }

  preload() {
    // Phaser rasterizes SVG assets at load time. Oversampling them here keeps
    // the original vector artwork crisp when we display it much smaller.
    const svgConfig = { width: FRUIT_SOURCE_SIZE, height: FRUIT_SOURCE_SIZE };
    this.load.svg("fruit-pepper", "/assets/produce/pepper.svg", svgConfig);
    this.load.svg("fruit-cherry", "/assets/produce/cherry.svg", svgConfig);
    this.load.svg("fruit-pea", "/assets/produce/pea-pod.svg", svgConfig);
    this.load.svg("fruit-carrot", "/assets/produce/carrot.svg", svgConfig);
    this.load.svg("fruit-broccoli", "/assets/produce/broccoli.svg", svgConfig);

    preloadHabitat(this);
  }

  /**
   * Class-field initialisers only run once per scene instance, so every piece
   * of run state has to be reset here or a restart inherits the dead run.
   */
  init() {
    this.score = 0;
    this.shownScore = 0;
    this.lives = 3;
    this.level = 1;
    this.combo = 0;
    this.brickTotal = 1;
    this.explosiveHits = 0;
    this.launched = false;
    this.gameOver = false;
    this.gameOverAt = 0;
    this.paused = false;
    this.transitioning = false;
    this.beatBest = false;
    this.paddleTurbo = false;
    this.timedEffects = new Map();
    this.chips = new Map();
    this.lifeIcons = [];
    this.motes = [];
    this.best = readBest();
    this.pets = loadPetSession();
  }

  create() {
    this.cameras.main.setBackgroundColor(COLORS.ink);
    this.cameras.main.roundPixels = true;

    createTextures(this);
    this.sfx = new Sfx(getAudioContext(this));

    this.createBackdrop();
    this.createEmitters();
    this.createHud();

    this.habitat = new Habitat(this);
    this.habitat.sync(this.pets.pets);

    // Paddle remains pure geometry. Swept collision below prevents tunneling.
    this.paddle = this.add.image(WIDTH / 2, PADDLE_Y, "paddle").setDepth(6);

    this.balls = this.physics.add.group({ allowGravity: false });
    this.drops = this.physics.add.group({ allowGravity: false });
    this.bricks = this.physics.add.staticGroup();
    this.decorations = this.add.group();

    // Ceiling sits under the HUD band so the ball never vanishes behind it.
    this.physics.world.setBounds(0, CEILING, WIDTH, FIELD_BOTTOM - CEILING + 60);
    this.physics.world.setBoundsCollision(true, true, true, false);
    this.physics.add.collider(
      this.balls,
      this.bricks,
      this.onBallBrick as Phaser.Types.Physics.Arcade.ArcadePhysicsCallback,
      undefined,
      this,
    );

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys("A,D,SPACE,R,P,M,ESC") as Record<
      string,
      Phaser.Input.Keyboard.Key
    >;

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (this.gameOver || this.paused) return;
      this.movePaddle(pointer.x);
      if (!this.launched) this.attachUnlaunchedBalls();
    });

    this.input.on("pointerdown", () => {
      this.sfx.resume();
      if (this.gameOver) this.tryRestart();
      else if (!this.paused) this.launch();
    });

    this.input.keyboard!.on("keydown", () => this.sfx.resume());

    this.startLevel();
  }

  update(time: number, delta: number) {
    const dt = Math.min(delta, 50) / 1000;

    if (Phaser.Input.Keyboard.JustDown(this.keys.M)) this.toggleMute();

    if (this.gameOver) {
      if (
        Phaser.Input.Keyboard.JustDown(this.keys.R) ||
        Phaser.Input.Keyboard.JustDown(this.keys.SPACE)
      ) {
        this.tryRestart();
      }
      this.driftMotes(dt);
      this.habitat.update(dt);
      return;
    }

    if (
      Phaser.Input.Keyboard.JustDown(this.keys.P) ||
      Phaser.Input.Keyboard.JustDown(this.keys.ESC)
    ) {
      this.togglePause();
    }
    if (this.paused) return;

    this.driftMotes(dt);
    this.habitat.update(dt);
    this.updateScoreReadout();
    this.updateChips();

    let direction = 0;
    if (this.cursors.left.isDown || this.keys.A.isDown) direction -= 1;
    if (this.cursors.right.isDown || this.keys.D.isDown) direction += 1;

    if (direction !== 0) {
      this.movePaddle(this.paddle.x + direction * this.paddleSpeed() * dt);
      if (!this.launched) this.attachUnlaunchedBalls();
    }

    if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) this.launch();

    let lowestBall = 0;
    this.balls.getChildren().forEach((child) => {
      const ball = child as Phaser.Physics.Arcade.Image;
      if (!ball.active) return;

      if (this.launched) {
        this.handlePaddleSweep(ball);
        this.normalizeBall(ball);
        this.reportWallHits(ball, time);
      }

      if (ball.y > FIELD_BOTTOM - 4) {
        this.sinkBall(ball);
        return;
      }

      lowestBall = Math.max(lowestBall, ball.y);
      this.pushTrail(ball);
      ball.setData("prevX", ball.x);
      ball.setData("prevY", ball.y);
    });

    this.drawTrails();
    this.drawAim();
    this.updateFloorGlow(lowestBall);
    this.updateDrops();

    if (this.launched && !this.transitioning && this.balls.countActive(true) === 0) {
      this.loseLife();
    }
  }

  // ---------------------------------------------------------------- movement

  private dynamicBody(image: Phaser.Physics.Arcade.Image) {
    return image.body as Phaser.Physics.Arcade.Body;
  }

  private paddleSpeed() {
    const base = Math.min(680, 540 + (this.level - 1) * 12);
    return this.paddleTurbo ? base * 1.45 : base;
  }

  /** Constant ball speed, ramping with the level and as the level empties. */
  private targetBallSpeed() {
    const remaining = this.bricks.countActive(true);
    const cleared = Phaser.Math.Clamp(1 - remaining / Math.max(1, this.brickTotal), 0, 1);
    return Math.min(690, 430 + (this.level - 1) * 20 + cleared * 70);
  }

  private movePaddle(x: number) {
    const half = this.paddle.displayWidth / 2;
    this.paddle.x = Math.round(Phaser.Math.Clamp(x, half + 12, WIDTH - half - 12));
    this.paddle.y = PADDLE_Y;
  }

  private handlePaddleSweep(ball: Phaser.Physics.Arcade.Image) {
    const body = this.dynamicBody(ball);
    if (body.velocity.y <= 0) return;

    const prevX = (ball.getData("prevX") as number | undefined) ?? ball.x;
    const prevY = (ball.getData("prevY") as number | undefined) ?? ball.y;

    const paddleTop = this.paddle.y - PADDLE_HEIGHT / 2;
    const prevBottom = prevY + BALL_RADIUS;
    const currentBottom = ball.y + BALL_RADIUS;
    if (prevBottom > paddleTop || currentBottom < paddleTop) return;

    const travel = currentBottom - prevBottom;
    const t = travel > 0 ? Phaser.Math.Clamp((paddleTop - prevBottom) / travel, 0, 1) : 1;
    const crossX = Phaser.Math.Linear(prevX, ball.x, t);

    const halfPaddle = this.paddle.displayWidth / 2;
    const left = this.paddle.x - halfPaddle - BALL_RADIUS;
    const right = this.paddle.x + halfPaddle + BALL_RADIUS;
    if (crossX < left || crossX > right) return;

    this.bounceFromPaddle(ball, crossX, paddleTop);
  }

  private bounceFromPaddle(ball: Phaser.Physics.Arcade.Image, crossX: number, paddleTop: number) {
    const body = this.dynamicBody(ball);
    const half = this.paddle.displayWidth / 2;
    const offset = Phaser.Math.Clamp((crossX - this.paddle.x) / half, -1, 1);
    const speed = this.targetBallSpeed();

    // A dead-centre hit still gets a small kick so the ball never locks into a
    // vertical bounce loop.
    const bias = Math.abs(offset) < 0.06 ? (offset >= 0 ? 0.06 : -0.06) : offset;
    const angleFromVertical = bias * Phaser.Math.DegToRad(58);

    ball.setPosition(Math.round(crossX), paddleTop - BALL_RADIUS - 0.5);
    body.updateFromGameObject();
    ball.setVelocity(Math.sin(angleFromVertical) * speed, -Math.cos(angleFromVertical) * speed);
    ball.setData("prevX", ball.x);
    ball.setData("prevY", ball.y);

    this.onPaddleHit(crossX, paddleTop, offset);
  }

  private onPaddleHit(x: number, y: number, offset: number) {
    this.combo = 0;
    this.sfx.play("paddle", offset * 3);
    this.sparkBurst.setParticleTint(COLORS.iceLight);
    this.sparkBurst.emitParticleAt(x, y, 5);

    this.tweens.killTweensOf(this.paddle);
    this.paddle.setScale(1, 0.68);
    this.tweens.add({
      targets: this.paddle,
      scaleY: 1,
      duration: 180,
      ease: "Back.easeOut",
    });
  }

  /**
   * Arcade bounce preserves whatever velocity a collision produces, which
   * eventually leaves the ball crawling along a near-horizontal line. Pinning
   * the speed and clamping the angle keeps every rally readable.
   */
  private normalizeBall(ball: Phaser.Physics.Arcade.Image) {
    const body = this.dynamicBody(ball);
    let { x: vx, y: vy } = body.velocity;
    if (vx === 0 && vy === 0) return;

    const speed = this.targetBallSpeed();
    const minVy = speed * 0.34;
    const minVx = speed * 0.14;

    if (Math.abs(vy) < minVy) vy = (vy < 0 ? -1 : 1) * minVy;
    if (Math.abs(vx) < minVx) vx = (vx === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(vx)) * minVx;

    const length = Math.hypot(vx, vy);
    body.velocity.set((vx / length) * speed, (vy / length) * speed);
  }

  private reportWallHits(ball: Phaser.Physics.Arcade.Image, time: number) {
    const body = this.dynamicBody(ball);
    if (!body.blocked.left && !body.blocked.right && !body.blocked.up) return;

    const readyAt = (ball.getData("wallAt") as number | undefined) ?? 0;
    if (time < readyAt) return;
    ball.setData("wallAt", time + 90);

    const x = body.blocked.left ? 2 : body.blocked.right ? WIDTH - 2 : ball.x;
    const y = body.blocked.up ? CEILING + 2 : ball.y;
    this.sparkBurst.setParticleTint(COLORS.iceLight);
    this.sparkBurst.emitParticleAt(x, y, 3);
    this.sfx.play("wall");
  }

  // ------------------------------------------------------------------ visual

  private createBackdrop() {
    const grid = this.add.graphics().setDepth(0);
    grid.lineStyle(1, COLORS.blue, 0.12);
    for (let x = 0; x <= WIDTH; x += 48) grid.lineBetween(x, 0, x, FIELD_BOTTOM);
    for (let y = 0; y <= FIELD_BOTTOM; y += 48) grid.lineBetween(0, y, WIDTH, y);

    // Slow frost motes give the empty field some life without costing much.
    for (let i = 0; i < 16; i++) {
      const mote = this.add
        .image(Phaser.Math.Between(0, WIDTH), Phaser.Math.Between(CEILING, FIELD_BOTTOM), "spark")
        .setScale(Phaser.Math.FloatBetween(0.4, 1.1))
        .setAlpha(Phaser.Math.FloatBetween(0.05, 0.16))
        .setDepth(0);
      mote.setData("speed", Phaser.Math.FloatBetween(6, 20));
      this.motes.push(mote);
    }

    this.trailGfx = this.add.graphics().setDepth(3.4);
    this.aimGfx = this.add.graphics().setDepth(6.4);

    // HUD band, plus a hard ice edge marking the ceiling the ball bounces off.
    this.add.rectangle(WIDTH / 2, CEILING / 2, WIDTH, CEILING, 0x06112a, 0.95).setDepth(5);
    this.add.rectangle(WIDTH / 2, CEILING, WIDTH, 2, 0x9fdcf5, 0.5).setDepth(5);

    this.add.rectangle(WIDTH / 2, FIELD_BOTTOM - 6, WIDTH, 12, COLORS.blue, 0.5).setDepth(1);
    this.floorGlow = this.add
      .rectangle(WIDTH / 2, FIELD_BOTTOM - 6, WIDTH, 12, COLORS.red, 0)
      .setDepth(1.1);
  }

  private createEmitters() {
    this.shardBurst = this.add
      .particles(0, 0, "shard", {
        speed: { min: 70, max: 280 },
        angle: { min: 0, max: 360 },
        lifespan: { min: 260, max: 560 },
        scale: { start: 1, end: 0.2 },
        alpha: { start: 0.95, end: 0 },
        rotate: { min: -220, max: 220 },
        gravityY: 300,
        tint: [0xffffff, 0xd6f4ff, 0x9fdcf5],
        emitting: false,
      })
      .setDepth(4);

    this.sparkBurst = this.add
      .particles(0, 0, "spark", {
        speed: { min: 40, max: 170 },
        angle: { min: 0, max: 360 },
        lifespan: { min: 160, max: 340 },
        scale: { start: 0.9, end: 0 },
        alpha: { start: 0.85, end: 0 },
        emitting: false,
      })
      .setDepth(7);
  }

  private createHud() {
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: FONT,
      fontSize: "20px",
      color: "#F7F2E7",
      stroke: "#081735",
      strokeThickness: 4,
    };
    const small: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: FONT,
      fontSize: "12px",
      color: "#7FA8D8",
    };

    this.scoreText = this.add.text(24, 16, "SCORE 000000", style).setDepth(10);
    this.bestText = this.add.text(24, 46, "BEST 000000", small).setDepth(10);
    this.levelText = this.add
      .text(WIDTH / 2, 16, "LEVEL 01", style)
      .setOrigin(0.5, 0)
      .setDepth(10);
    this.muteText = this.add
      .text(WIDTH - 20, FIELD_BOTTOM + 14, "", { ...small, color: "#3E5C8C", fontSize: "11px" })
      .setOrigin(1, 0)
      .setDepth(16);

    this.hintText = this.add
      .text(WIDTH / 2, FIELD_BOTTOM - 152, "", { ...style, fontSize: "16px", color: "#F2C94C" })
      .setOrigin(0.5)
      .setDepth(20);

    // Covers the field only, so the HUD and the habitat stay readable.
    this.scrim = this.add
      .rectangle(WIDTH / 2, (CEILING + FIELD_BOTTOM) / 2, WIDTH, FIELD_BOTTOM - CEILING, COLORS.ink, 1)
      .setDepth(29)
      .setAlpha(0);

    this.bannerText = this.add
      .text(WIDTH / 2, FIELD_BOTTOM / 2 - 40, "", {
        ...style,
        fontSize: "46px",
        align: "center",
        strokeThickness: 8,
      })
      .setLineSpacing(6)
      .setOrigin(0.5)
      .setDepth(30)
      .setAlpha(0);

    this.subBannerText = this.add
      .text(WIDTH / 2, FIELD_BOTTOM / 2 + 34, "", {
        ...style,
        fontSize: "18px",
        color: "#F2C94C",
        align: "center",
      })
      .setLineSpacing(8)
      .setOrigin(0.5)
      .setDepth(30)
      .setAlpha(0);

    this.pauseText = this.add
      .text(WIDTH / 2, FIELD_BOTTOM / 2, "PAUSED\nPRESS P TO RESUME", {
        ...style,
        fontSize: "32px",
        align: "center",
      })
      .setOrigin(0.5)
      .setDepth(40)
      .setVisible(false);

    this.refreshLives();
    this.refreshHud();
    this.updateMuteLabel();
  }

  private refreshHud() {
    this.levelText.setText(`LEVEL ${String(this.level).padStart(2, "0")}`);
    this.bestText.setText(`BEST ${String(Math.max(this.best, this.score)).padStart(6, "0")}`);
  }

  private updateScoreReadout() {
    if (this.shownScore === this.score) return;
    const step = Math.max(4, Math.ceil((this.score - this.shownScore) * 0.2));
    this.shownScore = Math.min(this.score, this.shownScore + step);
    this.scoreText.setText(`SCORE ${String(this.shownScore).padStart(6, "0")}`);
  }

  private addScore(points: number) {
    this.score += points;
    if (this.score > this.best) {
      this.best = this.score;
      this.beatBest = true;
      this.bestText.setText(`BEST ${String(this.best).padStart(6, "0")}`);
    }
  }

  private refreshLives() {
    this.lifeIcons.forEach((icon) => icon.destroy());
    this.lifeIcons = [];
    for (let i = 0; i < Math.max(0, this.lives); i++) {
      this.lifeIcons.push(
        this.add
          .image(WIDTH - 26 - i * 22, 26, "ball")
          .setScale(0.85)
          .setDepth(10),
      );
    }
  }

  private driftMotes(dt: number) {
    this.motes.forEach((mote) => {
      mote.y -= (mote.getData("speed") as number) * dt;
      if (mote.y < CEILING) {
        mote.y = FIELD_BOTTOM;
        mote.x = Phaser.Math.Between(0, WIDTH);
      }
    });
  }

  private updateFloorGlow(lowestBall: number) {
    const danger = Phaser.Math.Clamp((lowestBall - (FIELD_BOTTOM - 210)) / 170, 0, 1);
    this.floorGlow.setAlpha(danger * 0.75);
  }

  private pushTrail(ball: Phaser.Physics.Arcade.Image) {
    let trail = ball.getData("trail") as number[] | undefined;
    if (!trail) {
      trail = [];
      ball.setData("trail", trail);
    }
    trail.push(ball.x, ball.y);
    if (trail.length > TRAIL_POINTS * 2) trail.splice(0, trail.length - TRAIL_POINTS * 2);
  }

  private drawTrails() {
    this.trailGfx.clear();
    if (!this.launched) return;

    const color = this.explosiveHits > 0 ? COLORS.red : 0xa8e7ff;
    this.balls.getChildren().forEach((child) => {
      const ball = child as Phaser.Physics.Arcade.Image;
      if (!ball.active) return;
      const trail = ball.getData("trail") as number[] | undefined;
      if (!trail) return;

      const points = trail.length / 2;
      for (let i = 0; i < points; i++) {
        const t = (i + 1) / points;
        this.trailGfx.fillStyle(color, 0.46 * t * t);
        this.trailGfx.fillCircle(trail[i * 2], trail[i * 2 + 1], BALL_RADIUS * 0.86 * t);
      }
    });
  }

  private drawAim() {
    this.aimGfx.clear();
    if (this.launched || this.transitioning || this.gameOver) return;

    const ball = this.balls.getChildren()[0] as Phaser.Physics.Arcade.Image | undefined;
    if (!ball || !ball.active) return;

    const angle = this.aimAngle();
    const dx = Math.sin(angle);
    const dy = -Math.cos(angle);
    for (let i = 1; i <= 5; i++) {
      const distance = 22 + i * 18;
      this.aimGfx.fillStyle(COLORS.yellow, 0.85 - i * 0.12);
      this.aimGfx.fillCircle(ball.x + dx * distance, ball.y + dy * distance, 4.4 - i * 0.5);
    }
  }

  /** Serve always heads back toward the middle of the field. */
  private aimAngle() {
    const direction = this.paddle.x <= WIDTH / 2 ? 1 : -1;
    return Phaser.Math.DegToRad(30) * direction;
  }

  // ------------------------------------------------------------------- level

  private startLevel() {
    this.bricks.clear(true, true);
    this.balls.clear(true, true);
    this.clearDrops();
    this.decorations.clear(true, true);
    this.launched = false;
    this.combo = 0;
    this.transitioning = false;

    const plan = buildLevel(this.level);
    this.brickTotal = plan.cells.length;

    const total = 11 * BRICK_W + 10 * BRICK_GAP;
    const startX = (WIDTH - total) / 2 + BRICK_W / 2;

    plan.cells.forEach((cell) => {
      const x = Math.round(startX + cell.col * (BRICK_W + BRICK_GAP));
      const y = Math.round(GRID_TOP + cell.row * ROW_HEIGHT);
      const brick = this.bricks.create(
        x,
        y,
        cell.hp > 1 ? "brick-solid" : "brick",
      ) as Phaser.Physics.Arcade.Image;
      brick.setDepth(2).setAlpha(0).setScale(0.7, 0.5);

      const data: BrickData = { hp: cell.hp };
      const extras: Phaser.GameObjects.GameObject[] = [];

      if (cell.power) {
        data.power = cell.power;

        // No backing rectangle, no shadow ellipse, no border. The produce
        // stays clean and crisp; the ice block itself supplies the depth.
        const fruit = this.add
          .image(x, y, `fruit-${cell.power}`)
          .setDisplaySize(30, 30)
          .setAlpha(0)
          .setDepth(2.62);

        // A tiny free-floating highlight suggests glass without boxing the
        // fruit into its own framed UI element.
        const glint = this.add
          .rectangle(x - 5, y - 8, 20, 2, 0xffffff, 0.18)
          .setAngle(-5)
          .setAlpha(0)
          .setDepth(2.9);

        this.decorations.addMultiple([fruit, glint]);
        brick.setData("fruitSprite", fruit);
        brick.setData("fruitGlint", glint);
        extras.push(fruit, glint);
      }

      brick.setData("brickData", data);

      // Bottom rows land first: they are the ones a fast launch reaches first,
      // so nothing can be struck while it is still fading in.
      const delay = (plan.rows - 1 - cell.row) * 42 + cell.col * 7;
      this.tweens.add({
        targets: brick,
        alpha: 1,
        scaleX: 1,
        scaleY: 1,
        duration: 260,
        delay,
        ease: "Back.easeOut",
      });
      if (extras.length) {
        this.tweens.add({ targets: extras, alpha: 1, duration: 260, delay: delay + 60 });
      }
    });

    this.spawnBall(this.paddle.x, PADDLE_Y - 28, 0, 0);
    this.showHint(`${plan.name}  •  SPACE / CLICK TO LAUNCH`);
    this.refreshHud();
  }

  private completeLevel() {
    if (this.transitioning) return;
    this.transitioning = true;
    this.launched = false;
    this.combo = 0;

    const bonus = 500 + this.level * 100;
    this.addScore(bonus);
    this.sfx.play("levelup");
    this.cameras.main.flash(220, 120, 200, 235);
    this.hintText.setVisible(false);

    this.balls.getChildren().forEach((child) => {
      (child as Phaser.Physics.Arcade.Image).setVelocity(0, 0);
    });

    const progress = progressPetsForCompletedLevel(this.pets);
    this.pets = progress.state;
    this.habitat.sync(this.pets.pets);

    const notes = [`LEVEL BONUS +${bonus}`];
    if (progress.hatched.length === 1) {
      notes.push(`YOUR EGG HATCHED — ${SPECIES_NAMES[progress.hatched[0].species]}!`);
      this.sfx.play("egg");
    } else if (progress.hatched.length > 1) {
      notes.push(`${progress.hatched.length} EGGS HATCHED!`);
      this.sfx.play("egg");
    } else if (progress.foundEgg) {
      notes.push("YOU FOUND AN EGG!");
      this.sfx.play("egg");
    }

    this.showBanner(`LEVEL ${this.level} CLEAR`, notes.join("\n"), "#7DCFF3", 0.35);

    this.time.delayedCall(1500, () => {
      this.hideBanner();
      this.level += 1;
      this.startLevel();
    });
  }

  private showHint(text: string) {
    this.hintText.setText(text).setVisible(true).setAlpha(0);
    this.tweens.add({ targets: this.hintText, alpha: 1, duration: 240 });
  }

  private showBanner(title: string, subtitle: string, color: string, dim = 0.55) {
    this.tweens.killTweensOf([this.bannerText, this.subBannerText, this.scrim]);
    this.tweens.add({ targets: this.scrim, alpha: dim, duration: 260 });

    this.bannerText.setText(title).setColor(color).setAlpha(0).setScale(0.7);
    this.subBannerText.setText(subtitle).setAlpha(0);

    this.tweens.add({
      targets: this.bannerText,
      alpha: 1,
      scale: 1,
      duration: 300,
      ease: "Back.easeOut",
    });
    this.tweens.add({ targets: this.subBannerText, alpha: 1, duration: 300, delay: 120 });
  }

  private hideBanner() {
    this.tweens.killTweensOf(this.scrim);
    this.tweens.add({
      targets: [this.bannerText, this.subBannerText, this.scrim],
      alpha: 0,
      duration: 200,
    });
  }

  // ------------------------------------------------------------------- balls

  private spawnBall(x: number, y: number, vx: number, vy: number) {
    const ball = this.balls.create(
      Math.round(x),
      Math.round(y),
      "ball",
    ) as Phaser.Physics.Arcade.Image;
    ball.setCircle(BALL_RADIUS);
    ball.setCollideWorldBounds(true);
    ball.setBounce(1, 1);
    ball.setDepth(6.5);
    this.dynamicBody(ball).allowGravity = false;
    ball.setVelocity(vx, vy);
    ball.setData("prevX", ball.x);
    ball.setData("prevY", ball.y);
    ball.setData("trail", []);
    if (this.explosiveHits > 0) ball.setTint(COLORS.red);
    return ball;
  }

  private attachUnlaunchedBalls() {
    const count = this.balls.countActive(true);
    this.balls.getChildren().forEach((child, i) => {
      const ball = child as Phaser.Physics.Arcade.Image;
      if (this.dynamicBody(ball).velocity.lengthSq() !== 0) return;

      const x = Math.round(this.paddle.x + (i - (count - 1) / 2) * 20);
      const y = PADDLE_Y - 28;
      ball.setPosition(x, y);
      this.dynamicBody(ball).updateFromGameObject();
      ball.setData("prevX", x);
      ball.setData("prevY", y);
      ball.setData("trail", []);
    });
  }

  private launch() {
    if (this.gameOver || this.launched || this.transitioning) return;
    this.launched = true;
    this.hintText.setVisible(false);
    this.aimGfx.clear();
    this.sfx.play("launch");

    const angle = this.aimAngle();
    const speed = this.targetBallSpeed();
    this.balls.getChildren().forEach((child, index) => {
      const ball = child as Phaser.Physics.Arcade.Image;
      const spread = angle + Phaser.Math.DegToRad(index * 9 - 9);
      ball.setData("prevX", ball.x);
      ball.setData("prevY", ball.y);
      ball.setVelocity(Math.sin(spread) * speed, -Math.cos(spread) * speed);
    });
  }

  // ------------------------------------------------------------------ bricks

  private onBallBrick(
    ballObj: Phaser.GameObjects.GameObject,
    brickObj: Phaser.GameObjects.GameObject,
  ) {
    const ball = ballObj as Phaser.Physics.Arcade.Image;
    const brick = brickObj as Phaser.Physics.Arcade.Image;
    if (!brick.active || this.transitioning) return;

    const data = brick.getData("brickData") as BrickData;
    data.hp -= 1;
    this.flashBrick(brick);

    if (data.hp > 0) {
      brick.setTexture("brick-cracked");
      this.addScore(25);
      this.sfx.play("crack");
      this.sparkBurst.setParticleTint(COLORS.iceLight);
      this.sparkBurst.emitParticleAt(ball.x, ball.y, 4);
      return;
    }

    this.combo += 1;
    const multiplier = comboMultiplier(this.combo);
    const points = 100 * multiplier;

    const hitX = brick.x;
    const hitY = brick.y;
    this.breakBrick(brick, true);
    this.addScore(points);
    this.popup(
      hitX,
      hitY,
      multiplier > 1 ? `+${points}  ×${multiplier}` : `+${points}`,
      multiplier > 1 ? "#F2C94C" : "#F7F2E7",
    );
    this.sfx.play("shatter", Math.min(12, this.combo));
    this.pulseScore();

    if (this.explosiveHits > 0) {
      this.explosiveHits -= 1;
      this.explodeAt(hitX, hitY);
      if (this.explosiveHits === 0) {
        this.balls.getChildren().forEach((child) => {
          (child as Phaser.Physics.Arcade.Image).clearTint();
        });
      }
      this.refreshChips();
    }

    if (this.bricks.countActive(true) === 0) this.completeLevel();
  }

  private breakBrick(brick: Phaser.Physics.Arcade.Image, canDrop: boolean) {
    if (!brick.active) return;

    const data = brick.getData("brickData") as BrickData;
    const x = brick.x;
    const y = brick.y;

    (brick.getData("fruitSprite") as Phaser.GameObjects.Image | undefined)?.destroy();
    (brick.getData("fruitGlint") as Phaser.GameObjects.Rectangle | undefined)?.destroy();

    this.shardBurst.emitParticleAt(x, y, 10);
    brick.disableBody(true, true);
    if (canDrop && data.power) this.spawnDrop(x, y, data.power);
  }

  private explodeAt(x: number, y: number) {
    this.cameras.main.shake(120, 0.005);
    this.sfx.play("explode");

    const ring = this.add.circle(x, y, 10, COLORS.red, 0.28).setDepth(6);
    this.tweens.add({
      targets: ring,
      radius: 84,
      alpha: 0,
      duration: 260,
      onComplete: () => ring.destroy(),
    });

    this.sparkBurst.setParticleTint(COLORS.red);
    this.sparkBurst.emitParticleAt(x, y, 16);

    const victims = this.bricks.getChildren().filter((child) => {
      const brick = child as Phaser.Physics.Arcade.Image;
      return brick.active && Phaser.Math.Distance.Between(x, y, brick.x, brick.y) < 90;
    }) as Phaser.Physics.Arcade.Image[];

    if (victims.length) {
      const points = 75 * victims.length;
      this.addScore(points);
      this.popup(x, y - 26, `+${points}  BLAST`, "#E4573D");
    }
    victims.forEach((brick) => this.breakBrick(brick, true));
  }

  private flashBrick(brick: Phaser.Physics.Arcade.Image) {
    this.tweens.killTweensOf(brick);
    brick.setAlpha(1).setScale(1);
    this.tweens.add({
      targets: brick,
      alpha: 0.32,
      scaleX: 0.94,
      scaleY: 1.1,
      duration: 46,
      yoyo: true,
      onComplete: () => brick.setAlpha(1).setScale(1),
    });
  }

  private popup(x: number, y: number, text: string, color: string) {
    const label = this.add
      .text(x, y, text, {
        fontFamily: FONT,
        fontSize: "17px",
        color,
        stroke: "#081735",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(25);

    this.tweens.add({
      targets: label,
      y: y - 34,
      alpha: 0,
      duration: 640,
      ease: "Cubic.easeOut",
      onComplete: () => label.destroy(),
    });
  }

  private pulseScore() {
    this.tweens.killTweensOf(this.scoreText);
    this.scoreText.setScale(1.12);
    this.tweens.add({ targets: this.scoreText, scale: 1, duration: 180, ease: "Quad.easeOut" });
  }

  // ------------------------------------------------------------------- drops

  private spawnDrop(x: number, y: number, kind: PowerKind) {
    const drop = this.drops.create(
      Math.round(x),
      Math.round(y),
      `fruit-${kind}`,
    ) as Phaser.Physics.Arcade.Image;

    const scale = 46 / FRUIT_SOURCE_SIZE;
    drop.setScale(scale * 0.4);
    drop.setData("kind", kind);
    drop.setDepth(8);
    drop.setVelocityY(160);
    this.dynamicBody(drop).allowGravity = false;

    this.tweens.add({
      targets: drop,
      scaleX: scale,
      scaleY: scale,
      duration: 280,
      ease: "Back.easeOut",
    });
    this.tweens.add({
      targets: drop,
      angle: { from: -7, to: 7 },
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    // A thin accent ring reads as "collect me" without muddying the artwork.
    const ring = this.add.circle(x, y, 24).setStrokeStyle(2, POWERS[kind].accent, 0.7).setDepth(7.5);
    this.tweens.add({
      targets: ring,
      scale: 1.7,
      alpha: 0,
      duration: 780,
      repeat: -1,
      ease: "Quad.easeOut",
    });
    drop.setData("ring", ring);
  }

  private updateDrops() {
    const paddleBounds = this.paddle.getBounds();

    this.drops.getChildren().forEach((child) => {
      const drop = child as Phaser.Physics.Arcade.Image;
      if (!drop.active) return;

      const ring = drop.getData("ring") as Phaser.GameObjects.Arc | undefined;
      ring?.setPosition(drop.x, drop.y);

      if (Phaser.Geom.Intersects.RectangleToRectangle(paddleBounds, drop.getBounds())) {
        this.catchDrop(drop);
        return;
      }

      if (drop.y > FIELD_BOTTOM) this.destroyDrop(drop);
    });
  }

  private destroyDrop(drop: Phaser.Physics.Arcade.Image) {
    (drop.getData("ring") as Phaser.GameObjects.Arc | undefined)?.destroy();
    drop.destroy();
  }

  private clearDrops() {
    this.drops.getChildren().forEach((child) => {
      (
        (child as Phaser.Physics.Arcade.Image).getData("ring") as
          | Phaser.GameObjects.Arc
          | undefined
      )?.destroy();
    });
    this.drops.clear(true, true);
  }

  private catchDrop(drop: Phaser.Physics.Arcade.Image) {
    if (!drop.active) return;
    const kind = drop.getData("kind") as PowerKind;
    const x = drop.x;
    const y = drop.y;

    this.destroyDrop(drop);
    this.sparkBurst.setParticleTint(POWERS[kind].accent);
    this.sparkBurst.emitParticleAt(x, y, 14);
    this.activatePower(kind);
  }

  // --------------------------------------------------------------- power-ups

  private activatePower(kind: PowerKind) {
    this.showPowerMessage(POWERS[kind].label, POWERS[kind].accent);
    this.addScore(250);

    if (kind === "pepper") {
      this.explosiveHits = 3;
      this.sfx.play("power");
      this.balls.getChildren().forEach((child) => {
        (child as Phaser.Physics.Arcade.Image).setTint(COLORS.red);
      });
    } else if (kind === "cherry") {
      this.sfx.play("multiball");
      this.multiplyBalls(2);
    } else if (kind === "pea") {
      this.sfx.play("multiball");
      this.multiplyBalls(3);
    } else if (kind === "carrot") {
      this.sfx.play("power");
      this.setTimedEffect(
        "carrot",
        () => {
          this.paddleTurbo = true;
          this.refreshPaddleTint();
        },
        () => {
          this.paddleTurbo = false;
          this.refreshPaddleTint();
        },
      );
    } else if (kind === "broccoli") {
      this.sfx.play("power");
      this.setTimedEffect(
        "broccoli",
        () => this.setPaddleWidth(true),
        () => this.setPaddleWidth(false),
      );
    }

    this.refreshChips();
  }

  /**
   * Swapping textures rather than stretching one keeps the paddle's rounded
   * caps and centre highlight crisp at both widths.
   */
  private setPaddleWidth(wide: boolean) {
    const from = this.paddle.displayWidth;
    this.paddle.setTexture(wide ? "paddle-wide" : "paddle");
    this.paddle.setDisplaySize(wide ? WIDE_PADDLE_WIDTH : BASE_PADDLE_WIDTH, PADDLE_HEIGHT);
    this.refreshPaddleTint();

    this.tweens.killTweensOf(this.paddle);
    this.paddle.setScale(from / this.paddle.width, 1);
    this.tweens.add({
      targets: this.paddle,
      scaleX: 1,
      scaleY: 1,
      duration: 220,
      ease: "Back.easeOut",
    });
    this.movePaddle(this.paddle.x);
  }

  /** Big bar wins over turbo, so the two power-ups never cancel each other out. */
  private refreshPaddleTint() {
    if (this.timedEffects.has("broccoli")) this.paddle.setTint(COLORS.green);
    else if (this.paddleTurbo) this.paddle.setTint(COLORS.red);
    else this.paddle.clearTint();
  }

  private multiplyBalls(countPerBall: number) {
    const existing = this.balls.getChildren().slice() as Phaser.Physics.Arcade.Image[];
    const speed = this.targetBallSpeed();

    existing.forEach((ball) => {
      const velocity = this.dynamicBody(ball).velocity.clone();
      const baseAngle = velocity.lengthSq() > 0 ? velocity.angle() : -Math.PI / 2;

      for (let i = 1; i < countPerBall; i++) {
        if (this.balls.countActive(true) >= MAX_BALLS) return;
        const spread = Phaser.Math.DegToRad(i % 2 === 0 ? 19 : -19) * Math.ceil(i / 2);
        const angle = baseAngle + spread;
        this.spawnBall(ball.x, ball.y, Math.cos(angle) * speed, Math.sin(angle) * speed);
      }
    });

    this.launched = true;
  }

  /**
   * The timer is registered before start() and cleared before end() so those
   * callbacks can read the live set of active effects.
   */
  private setTimedEffect(kind: PowerKind, start: () => void, end: () => void) {
    this.timedEffects.get(kind)?.remove(false);

    this.timedEffects.set(
      kind,
      this.time.delayedCall(EFFECT_MS, () => {
        this.timedEffects.delete(kind);
        end();
        this.refreshChips();
      }),
    );

    start();
  }

  private showPowerMessage(text: string, accent: number) {
    const label = this.add
      .text(WIDTH / 2, FIELD_BOTTOM / 2 + 60, text, {
        fontFamily: FONT,
        fontSize: "34px",
        color: `#${accent.toString(16).padStart(6, "0")}`,
        stroke: "#081735",
        strokeThickness: 8,
        align: "center",
      })
      .setOrigin(0.5)
      .setScale(0.65)
      .setDepth(30);

    this.tweens.add({
      targets: label,
      scale: 1,
      y: label.y - 40,
      alpha: 0,
      duration: 900,
      ease: "Back.easeOut",
      onComplete: () => label.destroy(),
    });
  }

  // -------------------------------------------------------------- power chips

  private refreshChips() {
    const active = new Set<PowerKind>(this.timedEffects.keys());
    if (this.explosiveHits > 0) active.add("pepper");

    this.chips.forEach((chip, kind) => {
      if (active.has(kind)) return;
      chip.container.destroy();
      this.chips.delete(kind);
    });

    active.forEach((kind) => {
      if (!this.chips.has(kind)) this.chips.set(kind, this.createChip(kind));
    });

    const chips = [...this.chips.values()];
    const spacing = 118;
    chips.forEach((chip, i) => {
      chip.container.x = WIDTH / 2 + (i - (chips.length - 1) / 2) * spacing;
      chip.container.y = 54;
    });
  }

  private createChip(kind: PowerKind): Chip {
    const width = 110;
    const height = 28;
    const accent = POWERS[kind].accent;
    const barWidth = width - 42;

    const plate = this.add.graphics();
    plate.fillStyle(0x0d3554, 0.62);
    plate.fillRoundedRect(-width / 2, -height / 2, width, height, 8);
    plate.lineStyle(1, 0x9fdcf5, 0.45);
    plate.strokeRoundedRect(-width / 2 + 0.5, -height / 2 + 0.5, width - 1, height - 1, 8);

    const icon = this.add.image(-width / 2 + 17, 0, `fruit-${kind}`).setDisplaySize(22, 22);
    const label = this.add
      .text(-width / 2 + 32, -10, POWERS[kind].chip, {
        fontFamily: FONT,
        fontSize: "11px",
        color: "#F7F2E7",
      })
      .setOrigin(0, 0);

    const track = this.add
      .rectangle(-width / 2 + 32, 8, barWidth, 3, 0xffffff, 0.16)
      .setOrigin(0, 0.5);
    const bar = this.add.rectangle(-width / 2 + 32, 8, barWidth, 3, accent, 1).setOrigin(0, 0.5);

    const container = this.add
      .container(WIDTH / 2, 54, [plate, icon, label, track, bar])
      .setDepth(12)
      .setScale(0.6);
    this.tweens.add({ targets: container, scale: 1, duration: 220, ease: "Back.easeOut" });

    return { kind, container, bar, barWidth };
  }

  private updateChips() {
    this.chips.forEach((chip, kind) => {
      const timer = this.timedEffects.get(kind);
      const ratio = kind === "pepper" ? this.explosiveHits / 3 : timer ? 1 - timer.getProgress() : 0;
      chip.bar.width = Math.max(0, chip.barWidth * ratio);
    });
  }

  // ------------------------------------------------------------------- flow

  /** Balls shatter on the ice floor rather than sliding into the habitat. */
  private sinkBall(ball: Phaser.Physics.Arcade.Image) {
    this.shardBurst.emitParticleAt(ball.x, FIELD_BOTTOM - 10, 8);
    ball.destroy();
  }

  private loseLife() {
    this.launched = false;
    this.lives -= 1;
    this.combo = 0;
    this.explosiveHits = 0;
    this.trailGfx.clear();
    this.refreshChips();
    this.refreshLives();

    this.cameras.main.shake(260, 0.011);
    this.cameras.main.flash(240, 120, 24, 18);
    this.sfx.play("lose");
    this.habitat.startle();

    if (this.lives <= 0) {
      this.endGame();
      return;
    }

    this.spawnBall(this.paddle.x, PADDLE_Y - 28, 0, 0);
    this.showHint("BALL LOST  •  SPACE / CLICK TO LAUNCH");
  }

  private endGame() {
    this.gameOver = true;
    this.gameOverAt = this.time.now;
    this.hintText.setVisible(false);
    this.aimGfx.clear();
    this.clearDrops();
    this.sfx.play("gameover");
    writeBest(this.best);

    this.timedEffects.forEach((timer) => timer.remove(false));
    this.timedEffects.clear();
    this.paddleTurbo = false;
    this.setPaddleWidth(false);
    this.refreshChips();
    this.shownScore = this.score;
    this.scoreText.setText(`SCORE ${String(this.score).padStart(6, "0")}`);

    const lines = [
      `SCORE ${String(this.score).padStart(6, "0")}`,
      this.beatBest ? "NEW BEST!" : `BEST ${String(this.best).padStart(6, "0")}`,
      "PRESS SPACE TO PLAY AGAIN",
    ];
    this.showBanner("GAME OVER", lines.join("\n"), "#E4573D");
  }

  private tryRestart() {
    if (!this.gameOver || this.time.now - this.gameOverAt < 500) return;
    this.hideBanner();
    this.scene.restart();
  }

  private togglePause() {
    this.paused = !this.paused;
    this.pauseText.setVisible(this.paused);
    if (this.paused) this.physics.world.pause();
    else this.physics.world.resume();
  }

  private toggleMute() {
    this.sfx.toggleMute();
    this.updateMuteLabel();
  }

  private updateMuteLabel() {
    this.muteText.setText(this.sfx.isMuted ? "SOUND OFF — M" : "SOUND ON — M   •   PAUSE — P");
  }
}

function comboMultiplier(combo: number) {
  return Phaser.Math.Clamp(1 + Math.floor((combo - 1) / 4), 1, 5);
}

function getAudioContext(scene: Phaser.Scene): AudioContext | null {
  const manager = scene.sound as Partial<Phaser.Sound.WebAudioSoundManager>;
  return manager.context ?? null;
}

function readBest() {
  try {
    return Math.max(0, Number.parseInt(localStorage.getItem(BEST_KEY) ?? "0", 10) || 0);
  } catch {
    return 0;
  }
}

function writeBest(best: number) {
  try {
    localStorage.setItem(BEST_KEY, String(best));
  } catch {
    // Storage can be unavailable in private/restricted contexts.
  }
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game",
  width: WIDTH,
  height: HEIGHT,
  antialias: true,
  roundPixels: true,
  backgroundColor: COLORS.ink,
  physics: {
    default: "arcade",
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [GameScene],
};

const game = new Phaser.Game(config);

// Handy for poking at the running scene from the dev console; stripped from
// production builds by the bundler.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).fruitblaster = game;
}
