import Phaser from "phaser";

const WIDTH = 960;
const HEIGHT = 640;
const PADDLE_Y = HEIGHT - 54;
const BALL_RADIUS = 9;
const FRUIT_SOURCE_SIZE = 256;

const COLORS = {
  ink: 0x081735,
  blue: 0x143d88,
  cream: 0xf7f2e7,
  yellow: 0xf2c94c,
  red: 0xe4573d,
  green: 0x3f6949,
};

type PowerKind = "pepper" | "cherry" | "pea" | "carrot" | "broccoli";

type BrickData = {
  hp: number;
  power?: PowerKind;
};

class GameScene extends Phaser.Scene {
  private paddle!: Phaser.GameObjects.Image;
  private balls!: Phaser.Physics.Arcade.Group;
  private bricks!: Phaser.Physics.Arcade.StaticGroup;
  private drops!: Phaser.Physics.Arcade.Group;
  private embeddedFruits!: Phaser.GameObjects.Group;

  private scoreText!: Phaser.GameObjects.Text;
  private livesText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;

  private score = 0;
  private lives = 3;
  private level = 1;
  private launched = false;
  private gameOver = false;
  private explosiveHits = 0;

  private paddleSpeed = 520;
  private readonly basePaddleWidth = 132;
  private readonly paddleHeight = 24;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private timedEffects = new Map<PowerKind, Phaser.Time.TimerEvent>();

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
  }

  create() {
    this.cameras.main.setBackgroundColor(COLORS.ink);
    this.cameras.main.roundPixels = true;

    this.createTextures();
    this.createBackdrop();
    this.createHud();

    // Paddle remains pure geometry. Swept collision below prevents tunneling.
    this.paddle = this.add.image(WIDTH / 2, PADDLE_Y, "paddle").setDepth(6);

    this.balls = this.physics.add.group({ allowGravity: false });
    this.drops = this.physics.add.group({ allowGravity: false });
    this.bricks = this.physics.add.staticGroup();
    this.embeddedFruits = this.add.group();

    this.physics.world.setBoundsCollision(true, true, true, false);
    this.physics.add.collider(
      this.balls,
      this.bricks,
      this.onBallBrick as Phaser.Types.Physics.Arcade.ArcadePhysicsCallback,
      undefined,
      this,
    );

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys("A,D,SPACE,R") as Record<string, Phaser.Input.Keyboard.Key>;

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (this.gameOver) return;
      this.movePaddle(pointer.x);
      if (!this.launched) this.attachUnlaunchedBalls();
    });

    this.input.on("pointerdown", () => this.launch());
    this.startLevel();
  }

  update(_: number, delta: number) {
    if (this.gameOver) {
      if (Phaser.Input.Keyboard.JustDown(this.keys.R)) this.scene.restart();
      return;
    }

    const dt = delta / 1000;
    let direction = 0;
    if (this.cursors.left.isDown || this.keys.A.isDown) direction -= 1;
    if (this.cursors.right.isDown || this.keys.D.isDown) direction += 1;

    if (direction !== 0) {
      this.movePaddle(this.paddle.x + direction * this.paddleSpeed * dt);
      if (!this.launched) this.attachUnlaunchedBalls();
    }

    if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) this.launch();

    this.balls.getChildren().forEach((child) => {
      const ball = child as Phaser.Physics.Arcade.Image;
      if (!ball.active) return;

      if (this.launched) this.handlePaddleSweep(ball);

      if (ball.y > HEIGHT + 30) {
        ball.destroy();
        return;
      }

      ball.setData("prevX", ball.x);
      ball.setData("prevY", ball.y);
    });

    const paddleBounds = this.paddle.getBounds();
    this.drops.getChildren().forEach((child) => {
      const drop = child as Phaser.Physics.Arcade.Image;
      if (!drop.active) return;

      const halo = drop.getData("halo") as Phaser.GameObjects.Arc | undefined;
      halo?.setPosition(Math.round(drop.x), Math.round(drop.y));

      if (Phaser.Geom.Intersects.RectangleToRectangle(paddleBounds, drop.getBounds())) {
        this.catchDrop(drop);
        return;
      }

      if (drop.y > HEIGHT + 40) {
        halo?.destroy();
        drop.destroy();
      }
    });

    if (this.launched && this.balls.countActive(true) === 0) this.loseLife();
  }

  private dynamicBody(image: Phaser.Physics.Arcade.Image) {
    return image.body as Phaser.Physics.Arcade.Body;
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

    const paddleTop = this.paddle.y - this.paddle.displayHeight / 2;
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
    const speed = Phaser.Math.Clamp(Math.max(440, body.velocity.length()), 440, 560);
    const angleFromVertical = offset * Phaser.Math.DegToRad(55);

    ball.setPosition(Math.round(crossX), paddleTop - BALL_RADIUS - 0.5);
    body.updateFromGameObject();
    ball.setVelocity(Math.sin(angleFromVertical) * speed, -Math.cos(angleFromVertical) * speed);
    ball.setData("prevX", ball.x);
    ball.setData("prevY", ball.y);
  }

  private createTextures() {
    const g = this.make.graphics({ x: 0, y: 0 });

    const drawIceBlock = (key: string, cracked: boolean) => {
      g.clear();

      // Deep rear volume. This is where the depth lives now, instead of a
      // dark box around the fruit artwork.
      g.fillStyle(0x020914, 0.5);
      g.fillRoundedRect(4, 7, 67, 25, 6);
      g.fillStyle(0x0d3554, 0.6);
      g.fillRoundedRect(2, 4, 68, 26, 6);

      // Main translucent ice body.
      g.fillStyle(0x67c9f2, 0.7);
      g.fillRoundedRect(0, 0, 70, 28, 6);
      g.fillStyle(0xcff3ff, 0.22);
      g.fillRoundedRect(4, 4, 62, 20, 4);

      // Frosty volume and cloudy inclusions.
      g.fillStyle(0xffffff, 0.08);
      g.fillEllipse(20, 15, 21, 10);
      g.fillEllipse(50, 13, 18, 8);
      g.fillStyle(0xbcecff, 0.1);
      g.fillEllipse(35, 20, 28, 6);

      // Trapped bubbles.
      g.fillStyle(0xffffff, 0.2);
      g.fillCircle(14, 10, 1.2);
      g.fillCircle(22, 19, 0.9);
      g.fillCircle(42, 8, 1.1);
      g.fillCircle(54, 17, 1.3);
      g.fillCircle(61, 11, 0.8);

      // Faceted bevels make the block read as a chunk of ice.
      g.fillStyle(0xffffff, 0.42);
      g.fillTriangle(4, 4, 66, 4, 60, 9);
      g.fillTriangle(4, 4, 10, 9, 10, 23);

      g.fillStyle(0x123f63, 0.42);
      g.fillTriangle(10, 23, 60, 23, 66, 28);
      g.fillTriangle(60, 9, 66, 4, 66, 28);

      // Internal refraction streaks.
      g.lineStyle(2, 0xffffff, 0.68);
      g.lineBetween(9, 5, 30, 5);
      g.lineStyle(1, 0xffffff, 0.4);
      g.lineBetween(14, 20, 29, 9);
      g.lineBetween(39, 21, 51, 8);
      g.lineBetween(47, 8, 62, 12);

      // Crisp glass shell.
      g.lineStyle(1, 0xffffff, 0.98);
      g.strokeRoundedRect(0.5, 0.5, 69, 27, 6);
      g.lineStyle(1, 0xdaf8ff, 0.66);
      g.strokeRoundedRect(4.5, 4.5, 61, 19, 4);

      if (cracked) {
        g.lineStyle(1.5, 0xffffff, 0.96);
        g.beginPath();
        g.moveTo(35, 2);
        g.lineTo(32, 9);
        g.lineTo(38, 14);
        g.lineTo(33, 22);
        g.lineTo(35, 29);
        g.moveTo(32, 9);
        g.lineTo(24, 13);
        g.lineTo(18, 22);
        g.moveTo(38, 14);
        g.lineTo(48, 10);
        g.lineTo(58, 15);
        g.strokePath();
      }

      g.generateTexture(key, 72, 33);
    };

    drawIceBlock("brick", false);
    drawIceBlock("brick-cracked", true);

    // Icy paddle.
    g.clear();
    g.fillStyle(0x020914, 0.64);
    g.fillRoundedRect(2, 5, this.basePaddleWidth - 2, 19, 9);
    g.fillStyle(0x7dcff3, 0.97);
    g.fillRoundedRect(0, 0, this.basePaddleWidth, 20, 9);
    g.fillStyle(0xeaf9ff, 0.44);
    g.fillRoundedRect(5, 3, this.basePaddleWidth - 10, 11, 6);
    g.fillStyle(COLORS.blue, 0.94);
    g.fillRoundedRect(18, 8, this.basePaddleWidth - 36, 7, 4);
    g.lineStyle(2, 0xffffff, 0.98);
    g.lineBetween(9, 3, 56, 3);
    g.lineStyle(1, 0xffffff, 0.8);
    g.strokeRoundedRect(0.5, 0.5, this.basePaddleWidth - 1, 19, 9);
    g.generateTexture("paddle", this.basePaddleWidth, this.paddleHeight);

    // Ball.
    g.clear();
    g.fillStyle(0xffffff, 1);
    g.fillCircle(9, 9, 8);
    g.lineStyle(2, 0xa8e7ff, 0.96);
    g.strokeCircle(9, 9, 7);
    g.fillStyle(0xe4faff, 0.94);
    g.fillCircle(6, 5, 2.3);
    g.generateTexture("ball", 18, 18);
    g.destroy();
  }

  private createBackdrop() {
    const grid = this.add.graphics();
    grid.lineStyle(1, COLORS.blue, 0.12);
    for (let x = 0; x <= WIDTH; x += 48) grid.lineBetween(x, 0, x, HEIGHT);
    for (let y = 0; y <= HEIGHT; y += 48) grid.lineBetween(0, y, WIDTH, y);

    this.add.rectangle(WIDTH / 2, 42, WIDTH, 84, 0x06112a, 0.95).setDepth(5);
    this.add.rectangle(WIDTH / 2, HEIGHT - 6, WIDTH, 12, COLORS.blue, 0.5);
  }

  private createHud() {
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: "Arial Black, Arial, sans-serif",
      fontSize: "18px",
      color: "#F7F2E7",
      stroke: "#081735",
      strokeThickness: 4,
    };

    this.scoreText = this.add.text(24, 22, "SCORE 000000", style).setDepth(10);
    this.levelText = this.add.text(WIDTH / 2, 22, "LEVEL 01", style).setOrigin(0.5, 0).setDepth(10);
    this.livesText = this.add.text(WIDTH - 24, 22, "BALLS × 3", style).setOrigin(1, 0).setDepth(10);
    this.messageText = this.add
      .text(WIDTH / 2, HEIGHT - 110, "SPACE / CLICK TO LAUNCH", {
        ...style,
        fontSize: "16px",
        color: "#F2C94C",
      })
      .setOrigin(0.5)
      .setDepth(20);
  }

  private startLevel() {
    this.bricks.clear(true, true);
    this.balls.clear(true, true);

    this.drops.getChildren().forEach((child) => {
      const drop = child as Phaser.Physics.Arcade.Image;
      const halo = drop.getData("halo") as Phaser.GameObjects.Arc | undefined;
      halo?.destroy();
    });
    this.drops.clear(true, true);
    this.embeddedFruits.clear(true, true);
    this.launched = false;

    const cols = 11;
    const rows = Math.min(5 + Math.floor((this.level - 1) / 2), 7);
    const gap = 8;
    const brickW = 72;
    const total = cols * brickW + (cols - 1) * gap;
    const startX = (WIDTH - total) / 2 + brickW / 2;
    const startY = 112;

    const specials: PowerKind[] = ["pepper", "cherry", "pea", "carrot", "broccoli"];
    const preferredCells = [2, 8, 14, 20, 26, 32, 38, 46, 52];
    const specialCells = new Set(preferredCells.filter((cell) => cell < rows * cols));
    let specialIndex = 0;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const index = row * cols + col;
        const x = Math.round(startX + col * (brickW + gap));
        const y = Math.round(startY + row * 40);
        const brick = this.bricks.create(x, y, "brick") as Phaser.Physics.Arcade.Image;
        brick.setDepth(2);

        const hp = this.level >= 3 && row < 2 ? 2 : 1;
        const data: BrickData = { hp };

        if (specialCells.has(index)) {
          data.power = specials[specialIndex % specials.length];
          specialIndex++;

          // No backing rectangle, no shadow ellipse, no border. The produce
          // stays clean and crisp; the ice block itself supplies the depth.
          const fruit = this.add
            .image(x, y, `fruit-${data.power}`)
            .setDisplaySize(35, 35)
            .setAlpha(1)
            .setDepth(2.62);

          // A tiny free-floating highlight suggests glass without boxing the
          // fruit into its own framed UI element.
          const glint = this.add
            .rectangle(x - 5, y - 8, 20, 2, 0xffffff, 0.18)
            .setAngle(-5)
            .setDepth(2.9);

          this.embeddedFruits.addMultiple([fruit, glint]);
          brick.setData("fruitSprite", fruit);
          brick.setData("fruitGlint", glint);
        }

        brick.setData("brickData", data);
        if (hp > 1) brick.setTint(0x8fc9e8);

        if (this.game.renderer.type === Phaser.WEBGL && index % 4 === 0) {
          brick.preFX?.addShine(0.14 + (index % 3) * 0.02, 0.16, 2.2, false);
        }
      }
    }

    this.spawnBall(this.paddle.x, PADDLE_Y - 28, 0, 0);
    this.messageText
      .setText(`LEVEL ${String(this.level).padStart(2, "0")}  •  SPACE / CLICK TO LAUNCH`)
      .setVisible(true);
    this.refreshHud();
  }

  private spawnBall(x: number, y: number, vx: number, vy: number) {
    const ball = this.balls.create(Math.round(x), Math.round(y), "ball") as Phaser.Physics.Arcade.Image;
    ball.setCircle(BALL_RADIUS);
    ball.setCollideWorldBounds(true);
    ball.setBounce(1, 1);
    this.dynamicBody(ball).allowGravity = false;
    ball.setVelocity(vx, vy);
    ball.setData("prevX", ball.x);
    ball.setData("prevY", ball.y);
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
    });
  }

  private launch() {
    if (this.gameOver || this.launched) return;
    this.launched = true;
    this.messageText.setVisible(false);

    this.balls.getChildren().forEach((child, index) => {
      const ball = child as Phaser.Physics.Arcade.Image;
      ball.setData("prevX", ball.x);
      ball.setData("prevY", ball.y);
      ball.setVelocity(index % 2 === 0 ? 245 : -245, -360);
    });
  }

  private onBallBrick(ballObj: Phaser.GameObjects.GameObject, brickObj: Phaser.GameObjects.GameObject) {
    const ball = ballObj as Phaser.Physics.Arcade.Image;
    const brick = brickObj as Phaser.Physics.Arcade.Image;
    if (!brick.active) return;

    const data = brick.getData("brickData") as BrickData;
    data.hp -= 1;
    this.score += 100;
    this.flashBrick(brick);

    if (data.hp > 0) {
      brick.setTexture("brick-cracked").setTint(0xd7efff);
      this.refreshHud();
      return;
    }

    const hitX = brick.x;
    const hitY = brick.y;
    this.breakBrick(brick, true);

    if (this.explosiveHits > 0) {
      this.explosiveHits -= 1;
      this.explodeAt(hitX, hitY);
      ball.setTint(this.explosiveHits > 0 ? COLORS.red : 0xffffff);
    }

    this.refreshHud();
    if (this.bricks.countActive(true) === 0) {
      this.level += 1;
      this.time.delayedCall(700, () => this.startLevel());
    }
  }

  private breakBrick(brick: Phaser.Physics.Arcade.Image, canDrop: boolean) {
    if (!brick.active) return;

    const data = brick.getData("brickData") as BrickData;
    const x = brick.x;
    const y = brick.y;

    (brick.getData("fruitSprite") as Phaser.GameObjects.Image | undefined)?.destroy();
    (brick.getData("fruitGlint") as Phaser.GameObjects.Rectangle | undefined)?.destroy();

    this.shatter(x, y);
    brick.disableBody(true, true);
    this.score += 50;
    if (canDrop && data.power) this.spawnDrop(x, y, data.power);
  }

  private explodeAt(x: number, y: number) {
    this.cameras.main.shake(90, 0.004);

    const ring = this.add.circle(x, y, 10, COLORS.red, 0.28).setDepth(6);
    this.tweens.add({
      targets: ring,
      radius: 78,
      alpha: 0,
      duration: 230,
      onComplete: () => ring.destroy(),
    });

    const victims = this.bricks.getChildren().filter((child) => {
      const brick = child as Phaser.Physics.Arcade.Image;
      return brick.active && Phaser.Math.Distance.Between(x, y, brick.x, brick.y) < 90;
    }) as Phaser.Physics.Arcade.Image[];

    victims.forEach((brick) => {
      this.score += 75;
      this.breakBrick(brick, true);
    });
  }

  private flashBrick(brick: Phaser.Physics.Arcade.Image) {
    this.tweens.add({
      targets: brick,
      alpha: 0.32,
      scaleX: 0.96,
      scaleY: 1.06,
      duration: 46,
      yoyo: true,
    });
  }

  private shatter(x: number, y: number) {
    for (let i = 0; i < 12; i++) {
      const shard = this.add
        .triangle(
          x,
          y,
          0,
          0,
          Phaser.Math.Between(5, 14),
          Phaser.Math.Between(2, 8),
          Phaser.Math.Between(-5, 0),
          Phaser.Math.Between(5, 14),
          i % 4 === 0 ? 0xffffff : 0xbcecff,
          Phaser.Math.FloatBetween(0.58, 0.94),
        )
        .setDepth(4);

      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const distance = Phaser.Math.Between(24, 74);
      this.tweens.add({
        targets: shard,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance + Phaser.Math.Between(4, 24),
        angle: Phaser.Math.Between(-240, 240),
        scale: Phaser.Math.FloatBetween(0.45, 1.2),
        alpha: 0,
        duration: Phaser.Math.Between(260, 520),
        ease: "Quad.easeOut",
        onComplete: () => shard.destroy(),
      });
    }
  }

  private spawnDrop(x: number, y: number, kind: PowerKind) {
    const drop = this.drops.create(Math.round(x), Math.round(y), `fruit-${kind}`) as Phaser.Physics.Arcade.Image;
    drop.setDisplaySize(48, 48);
    drop.setData("kind", kind);
    drop.setVelocityY(155);
    drop.setDepth(8);
    this.dynamicBody(drop).allowGravity = false;

    const halo = this.add.circle(x, y, 30, COLORS.cream, 0.16).setDepth(7);
    this.tweens.add({ targets: halo, scale: 1.42, alpha: 0, duration: 650, repeat: -1 });
    drop.setData("halo", halo);
  }

  private catchDrop(drop: Phaser.Physics.Arcade.Image) {
    if (!drop.active) return;
    const kind = drop.getData("kind") as PowerKind;
    const halo = drop.getData("halo") as Phaser.GameObjects.Arc | undefined;
    halo?.destroy();
    drop.destroy();
    this.activatePower(kind);
  }

  private activatePower(kind: PowerKind) {
    const names: Record<PowerKind, string> = {
      pepper: "HOT BALL!",
      cherry: "DOUBLE TROUBLE!",
      pea: "PEA SHOOTER ×3!",
      carrot: "TURBO PADDLE!",
      broccoli: "BIG BAR!",
    };

    this.showPowerMessage(names[kind]);
    this.score += 250;

    if (kind === "pepper") {
      this.explosiveHits = 3;
      this.balls.getChildren().forEach((child) => {
        (child as Phaser.Physics.Arcade.Image).setTint(COLORS.red);
      });
    } else if (kind === "cherry") {
      this.multiplyBalls(2);
    } else if (kind === "pea") {
      this.multiplyBalls(3);
    } else if (kind === "carrot") {
      this.setTimedEffect(
        "carrot",
        12000,
        () => {
          this.paddleSpeed = 760;
          this.paddle.setTint(COLORS.red);
        },
        () => {
          this.paddleSpeed = 520;
          this.paddle.clearTint();
        },
      );
    } else if (kind === "broccoli") {
      this.setTimedEffect(
        "broccoli",
        12000,
        () => {
          this.paddle.setDisplaySize(this.basePaddleWidth * 1.55, this.paddleHeight);
          this.paddle.setTint(COLORS.green);
          this.movePaddle(this.paddle.x);
        },
        () => {
          this.paddle.setDisplaySize(this.basePaddleWidth, this.paddleHeight);
          this.paddle.clearTint();
          this.movePaddle(this.paddle.x);
        },
      );
    }

    this.refreshHud();
  }

  private multiplyBalls(countPerBall: number) {
    const existing = this.balls.getChildren().slice() as Phaser.Physics.Arcade.Image[];

    existing.forEach((ball) => {
      const velocity = this.dynamicBody(ball).velocity.clone();
      const speed = Math.max(440, velocity.length());
      const baseAngle = velocity.angle();

      for (let i = 1; i < countPerBall; i++) {
        const spread = Phaser.Math.DegToRad(i % 2 === 0 ? 17 : -17) * Math.ceil(i / 2);
        const angle = baseAngle + spread;
        this.spawnBall(ball.x, ball.y, Math.cos(angle) * speed, Math.sin(angle) * speed);
      }
    });

    this.launched = true;
  }

  private setTimedEffect(kind: PowerKind, duration: number, start: () => void, end: () => void) {
    this.timedEffects.get(kind)?.remove(false);
    start();

    this.timedEffects.set(
      kind,
      this.time.delayedCall(duration, () => {
        end();
        this.timedEffects.delete(kind);
      }),
    );
  }

  private showPowerMessage(text: string) {
    const label = this.add
      .text(WIDTH / 2, HEIGHT / 2 + 40, text, {
        fontFamily: "Arial Black, Arial, sans-serif",
        fontSize: "36px",
        color: "#F2C94C",
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
      y: label.y - 35,
      alpha: 0,
      duration: 900,
      ease: "Back.easeOut",
      onComplete: () => label.destroy(),
    });
  }

  private loseLife() {
    this.launched = false;
    this.lives -= 1;
    this.refreshHud();

    if (this.lives <= 0) {
      this.gameOver = true;
      this.messageText
        .setText(`GAME OVER\nSCORE ${String(this.score).padStart(6, "0")}\nPRESS R TO RESTART`)
        .setVisible(true)
        .setStyle({ fontSize: "28px", align: "center", color: "#E4573D" });
      return;
    }

    this.spawnBall(this.paddle.x, PADDLE_Y - 28, 0, 0);
    this.messageText.setText("BALL LOST  •  SPACE / CLICK TO LAUNCH").setVisible(true);
  }

  private refreshHud() {
    this.scoreText.setText(`SCORE ${String(this.score).padStart(6, "0")}`);
    this.levelText.setText(`LEVEL ${String(this.level).padStart(2, "0")}`);
    this.livesText.setText(`BALLS × ${this.lives}`);
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

new Phaser.Game(config);
