import Phaser from "phaser";

const WIDTH = 960;
const HEIGHT = 640;
const PADDLE_Y = HEIGHT - 54;
const COLORS = {
  ink: 0x081735,
  blue: 0x143d88,
  cream: 0xf7f2e7,
  yellow: 0xf2c94c,
  red: 0xe4573d,
  green: 0x3f6949,
  plum: 0x493044,
  glass: 0xbfe7ff,
};

type PowerKind = "pepper" | "cherry" | "pea" | "carrot" | "broccoli";

type BrickData = {
  hp: number;
  power?: PowerKind;
};

class GameScene extends Phaser.Scene {
  private paddle!: Phaser.Physics.Arcade.Image;
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
  private basePaddleWidth = 132;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private timedEffects = new Map<PowerKind, Phaser.Time.TimerEvent>();

  constructor() {
    super("game");
  }

  preload() {
    this.load.svg("fruit-pepper", "/assets/produce/pepper.svg", { width: 48, height: 48 });
    this.load.svg("fruit-cherry", "/assets/produce/cherry.svg", { width: 48, height: 48 });
    this.load.svg("fruit-pea", "/assets/produce/pea-pod.svg", { width: 48, height: 48 });
    this.load.svg("fruit-carrot", "/assets/produce/carrot.svg", { width: 48, height: 48 });
    this.load.svg("fruit-broccoli", "/assets/produce/broccoli.svg", { width: 48, height: 48 });
  }

  create() {
    this.cameras.main.setBackgroundColor(COLORS.ink);
    this.createTextures();
    this.createBackdrop();
    this.createHud();

    this.paddle = this.physics.add.staticImage(WIDTH / 2, PADDLE_Y, "paddle");

    this.balls = this.physics.add.group({ allowGravity: false });
    this.drops = this.physics.add.group({ allowGravity: false });
    this.bricks = this.physics.add.staticGroup();
    this.embeddedFruits = this.add.group();

    this.physics.world.setBoundsCollision(true, true, true, false);

    // Paddle uses overlap + an explicit bounce instead of Arcade separation.
    // That avoids the static-body pinning/sticking case entirely.
    this.physics.add.overlap(
      this.balls,
      this.paddle,
      this.onBallPaddle as Phaser.Types.Physics.Arcade.ArcadePhysicsCallback,
      undefined,
      this,
    );
    this.physics.add.collider(
      this.balls,
      this.bricks,
      this.onBallBrick as Phaser.Types.Physics.Arcade.ArcadePhysicsCallback,
      undefined,
      this,
    );
    this.physics.add.overlap(
      this.paddle,
      this.drops,
      this.onCatchDrop as Phaser.Types.Physics.Arcade.ArcadePhysicsCallback,
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
      if (ball.y > HEIGHT + 30) ball.destroy();
    });

    this.drops.getChildren().forEach((child) => {
      const drop = child as Phaser.Physics.Arcade.Image;
      const halo = drop.getData("halo") as Phaser.GameObjects.Arc | undefined;
      halo?.setPosition(drop.x, drop.y);
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
    this.paddle.setPosition(Phaser.Math.Clamp(x, half + 12, WIDTH - half - 12), PADDLE_Y);
    this.paddle.refreshBody();
  }

  private createTextures() {
    const g = this.make.graphics({ x: 0, y: 0 });

    // ICE / GLASS BRICK
    g.fillStyle(0x071b37, 0.42);
    g.fillRoundedRect(2, 4, 69, 26, 6);
    g.fillStyle(0x8ed5f7, 0.48);
    g.fillRoundedRect(0, 0, 70, 27, 6);
    g.fillStyle(0xdff6ff, 0.34);
    g.fillRoundedRect(4, 4, 62, 19, 4);
    g.fillStyle(0xffffff, 0.25);
    g.fillTriangle(4, 4, 66, 4, 61, 9);
    g.fillTriangle(4, 4, 9, 9, 9, 22);
    g.fillStyle(0x397faa, 0.22);
    g.fillTriangle(9, 22, 61, 22, 66, 26);
    g.fillTriangle(61, 9, 66, 4, 66, 26);
    g.lineStyle(1, 0xffffff, 0.92);
    g.strokeRoundedRect(0.5, 0.5, 69, 26, 6);
    g.lineStyle(1, 0xbcecff, 0.6);
    g.strokeRoundedRect(4.5, 4.5, 61, 18, 4);
    g.lineStyle(2, 0xffffff, 0.62);
    g.lineBetween(9, 5, 28, 5);
    g.lineStyle(1, 0xffffff, 0.42);
    g.lineBetween(46, 8, 61, 12);
    g.lineBetween(13, 19, 27, 9);
    g.generateTexture("brick", 72, 30);
    g.clear();

    // Reinforced blocks become visibly cracked after their first hit.
    g.fillStyle(0x071b37, 0.42);
    g.fillRoundedRect(2, 4, 69, 26, 6);
    g.fillStyle(0x8ed5f7, 0.48);
    g.fillRoundedRect(0, 0, 70, 27, 6);
    g.fillStyle(0xdff6ff, 0.34);
    g.fillRoundedRect(4, 4, 62, 19, 4);
    g.fillStyle(0xffffff, 0.25);
    g.fillTriangle(4, 4, 66, 4, 61, 9);
    g.fillTriangle(4, 4, 9, 9, 9, 22);
    g.fillStyle(0x397faa, 0.22);
    g.fillTriangle(9, 22, 61, 22, 66, 26);
    g.fillTriangle(61, 9, 66, 4, 66, 26);
    g.lineStyle(1, 0xffffff, 0.92);
    g.strokeRoundedRect(0.5, 0.5, 69, 26, 6);
    g.lineStyle(1.4, 0xeafaff, 0.86);
    g.beginPath();
    g.moveTo(35, 3);
    g.lineTo(32, 10);
    g.lineTo(38, 14);
    g.lineTo(33, 21);
    g.lineTo(35, 27);
    g.moveTo(32, 10);
    g.lineTo(24, 13);
    g.lineTo(18, 20);
    g.moveTo(38, 14);
    g.lineTo(48, 11);
    g.lineTo(56, 15);
    g.strokePath();
    g.generateTexture("brick-cracked", 72, 30);
    g.clear();

    g.fillStyle(0x06172e, 0.55);
    g.fillRoundedRect(2, 4, this.basePaddleWidth - 2, 19, 9);
    g.fillStyle(0x9fddf8, 0.78);
    g.fillRoundedRect(0, 0, this.basePaddleWidth, 20, 9);
    g.fillStyle(0xeaf8ff, 0.45);
    g.fillRoundedRect(5, 3, this.basePaddleWidth - 10, 11, 6);
    g.fillStyle(COLORS.blue, 0.95);
    g.fillRoundedRect(18, 8, this.basePaddleWidth - 36, 7, 4);
    g.lineStyle(2, 0xffffff, 0.88);
    g.lineBetween(9, 3, 54, 3);
    g.lineStyle(1, 0xffffff, 0.75);
    g.strokeRoundedRect(0.5, 0.5, this.basePaddleWidth - 1, 19, 9);
    g.generateTexture("paddle", this.basePaddleWidth, 24);
    g.clear();

    g.fillStyle(0xffffff, 1);
    g.fillCircle(9, 9, 8);
    g.lineStyle(2, 0x9fdcff, 0.9);
    g.strokeCircle(9, 9, 7);
    g.fillStyle(0xc8f1ff, 0.8);
    g.fillCircle(6, 5, 2.2);
    g.generateTexture("ball", 18, 18);
    g.destroy();
  }

  private createBackdrop() {
    const grid = this.add.graphics();
    grid.lineStyle(1, COLORS.blue, 0.14);
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
    const totalCells = rows * cols;
    // Distributed on purpose so every first level visibly demonstrates power-ups.
    const preferredCells = [2, 8, 14, 20, 26, 32, 38, 46, 52];
    const specialCells = new Set(preferredCells.filter((cell) => cell < totalCells));

    let specialIndex = 0;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const index = row * cols + col;
        const x = startX + col * (brickW + gap);
        const y = startY + row * 40;
        const brick = this.bricks.create(x, y, "brick") as Phaser.Physics.Arcade.Image;
        brick.setDepth(2);
        const hp = this.level >= 3 && row < 2 ? 2 : 1;
        const data: BrickData = { hp };

        if (specialCells.has(index)) {
          data.power = specials[specialIndex % specials.length];
          specialIndex++;

          // Put produce visually above the transparent brick so it reads
          // immediately, then add a faint glass face over it to keep the
          // "frozen inside" illusion.
          const inset = this.add
            .rectangle(x, y, 39, 24, 0x081735, 0.32)
            .setStrokeStyle(1, 0xdff6ff, 0.72)
            .setDepth(2.35);
          const fruit = this.add
            .image(x, y, `fruit-${data.power}`)
            .setDisplaySize(30, 30)
            .setAlpha(1)
            .setDepth(2.6);
          const glassFace = this.add
            .rectangle(x - 3, y - 4, 30, 4, 0xffffff, 0.18)
            .setAngle(-4)
            .setDepth(2.8);

          this.embeddedFruits.addMultiple([inset, fruit, glassFace]);
          brick.setData("fruitSprite", fruit);
          brick.setData("fruitInset", inset);
          brick.setData("fruitGlass", glassFace);
        }

        brick.setData("brickData", data);
        if (hp > 1) brick.setTint(0x8fc9e8);

        if (this.game.renderer.type === Phaser.WEBGL && index % 4 === 0) {
          brick.preFX?.addShine(0.16 + (index % 3) * 0.025, 0.22, 2.4, false);
        }
      }
    }

    this.spawnBall(this.paddle.x, this.paddle.y - 27, 0, 0);
    this.messageText.setText(`LEVEL ${String(this.level).padStart(2, "0")}  •  SPACE / CLICK TO LAUNCH`).setVisible(true);
    this.refreshHud();
  }

  private spawnBall(x: number, y: number, vx: number, vy: number) {
    const ball = this.balls.create(x, y, "ball") as Phaser.Physics.Arcade.Image;
    ball.setCircle(9).setCollideWorldBounds(true).setBounce(1, 1);
    ball.setVelocity(vx, vy);
    return ball;
  }

  private attachUnlaunchedBalls() {
    this.balls.getChildren().forEach((child, i) => {
      const ball = child as Phaser.Physics.Arcade.Image;
      if (this.dynamicBody(ball).velocity.lengthSq() === 0) {
        ball.setPosition(this.paddle.x + (i - (this.balls.countActive(true) - 1) / 2) * 20, this.paddle.y - 27);
      }
    });
  }

  private launch() {
    if (this.gameOver || this.launched) return;
    this.launched = true;
    this.messageText.setVisible(false);
    this.balls.getChildren().forEach((child, index) => {
      const ball = child as Phaser.Physics.Arcade.Image;
      ball.setVelocity(index % 2 === 0 ? 245 : -245, -360);
    });
  }

  private onBallPaddle(ballObj: Phaser.GameObjects.GameObject) {
    const ball = ballObj as Phaser.Physics.Arcade.Image;
    const body = this.dynamicBody(ball);
    if (body.velocity.y <= 0) return;

    const offset = Phaser.Math.Clamp((ball.x - this.paddle.x) / (this.paddle.displayWidth / 2), -1, 1);
    const speed = Math.max(430, body.velocity.length());
    const vx = offset * 360;
    const vy = -Math.sqrt(Math.max(160 * 160, speed * speed - vx * vx));

    // Explicitly lift the ball clear of the overlap before changing direction.
    // This guarantees the callback cannot immediately re-fire and pin it.
    ball.setY(this.paddle.y - this.paddle.displayHeight / 2 - ball.displayHeight / 2 - 2);
    ball.setVelocity(vx, vy);
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

    this.breakBrick(brick, true);

    if (this.explosiveHits > 0) {
      this.explosiveHits -= 1;
      this.explodeAt(brick.x, brick.y);
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
    const fruitSprite = brick.getData("fruitSprite") as Phaser.GameObjects.Image | undefined;
    const fruitInset = brick.getData("fruitInset") as Phaser.GameObjects.Rectangle | undefined;
    const fruitGlass = brick.getData("fruitGlass") as Phaser.GameObjects.Rectangle | undefined;
    fruitSprite?.destroy();
    fruitInset?.destroy();
    fruitGlass?.destroy();

    this.shatter(brick.x, brick.y);
    brick.disableBody(true, true);
    this.score += 50;

    if (canDrop && data.power) this.spawnDrop(brick.x, brick.y, data.power);
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
    this.tweens.add({ targets: brick, alpha: 0.3, scaleX: 0.94, scaleY: 1.08, duration: 50, yoyo: true });
  }

  private shatter(x: number, y: number) {
    for (let i = 0; i < 10; i++) {
      const shard = this.add
        .triangle(
          x,
          y,
          0,
          0,
          Phaser.Math.Between(5, 13),
          Phaser.Math.Between(2, 8),
          Phaser.Math.Between(-5, 0),
          Phaser.Math.Between(5, 13),
          i % 3 === 0 ? 0xffffff : 0xbcecff,
          Phaser.Math.FloatBetween(0.58, 0.92),
        )
        .setDepth(4);
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const distance = Phaser.Math.Between(22, 70);
      this.tweens.add({
        targets: shard,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance + Phaser.Math.Between(4, 22),
        angle: Phaser.Math.Between(-220, 220),
        scale: Phaser.Math.FloatBetween(0.45, 1.2),
        alpha: 0,
        duration: Phaser.Math.Between(260, 500),
        ease: "Quad.easeOut",
        onComplete: () => shard.destroy(),
      });
    }
  }

  private spawnDrop(x: number, y: number, kind: PowerKind) {
    const drop = this.drops.create(x, y, `fruit-${kind}`) as Phaser.Physics.Arcade.Image;
    drop.setDisplaySize(48, 48).setData("kind", kind).setVelocityY(155).setDepth(8);
    const halo = this.add.circle(x, y, 30, COLORS.cream, 0.18).setDepth(7);
    this.tweens.add({ targets: halo, scale: 1.45, alpha: 0, duration: 650, repeat: -1 });
    drop.setData("halo", halo);
  }

  private onCatchDrop(_: Phaser.GameObjects.GameObject, dropObj: Phaser.GameObjects.GameObject) {
    const drop = dropObj as Phaser.Physics.Arcade.Image;
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
      this.balls.getChildren().forEach((b) => (b as Phaser.Physics.Arcade.Image).setTint(COLORS.red));
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
          this.paddle.setDisplaySize(this.basePaddleWidth * 1.55, 24);
          this.paddle.setTint(COLORS.green);
          this.movePaddle(this.paddle.x);
        },
        () => {
          this.paddle.setDisplaySize(this.basePaddleWidth, 24);
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
      const speed = Math.max(430, velocity.length());
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

    this.spawnBall(this.paddle.x, this.paddle.y - 27, 0, 0);
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
