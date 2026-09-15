import Phaser from "phaser";
import { DinoSpecies, PetRecord } from "./pets";
import { COLORS, FONT, HABITAT_GROUND, HABITAT_H, FIELD_BOTTOM, WIDTH } from "./theme";

/**
 * The habitat is the strip below the playfield where eggs sit and hatched
 * dinos potter about. It is deliberately non-interactive: it never touches the
 * ball, the paddle or the score, it just gives the player something to collect.
 */

export const DINO_SIZE = { w: 46, h: 40 };
export const EGG_SIZE = { w: 22, h: 27 };

const WALK_MIN = 130;
const WALK_MAX = WIDTH - 210;

type Activity = "walk" | "idle" | "sleep";

type Critter = {
  id: string;
  stage: "egg" | "dino";
  species: DinoSpecies;
  sprite: Phaser.GameObjects.Image;
  activity: Activity;
  timer: number;
  direction: 1 | -1;
  speed: number;
  bob: number;
  sleepTick: number;
};

export function preloadHabitat(scene: Phaser.Scene) {
  const dino = { width: DINO_SIZE.w * 4, height: DINO_SIZE.h * 4 };
  const egg = { width: EGG_SIZE.w * 4, height: EGG_SIZE.h * 4 };
  (["stretch", "spike", "chomp"] as DinoSpecies[]).forEach((species) => {
    scene.load.svg(`dino-${species}`, `/assets/pets/${species}.svg`, dino);
    scene.load.svg(`egg-${species}`, `/assets/pets/egg-${species}.svg`, egg);
  });
}

export class Habitat {
  private critters: Critter[] = [];
  private layer: Phaser.GameObjects.Container;

  constructor(private scene: Phaser.Scene) {
    const shelf = scene.add.graphics();
    shelf.fillStyle(0x0a1c3d, 1);
    shelf.fillRect(0, FIELD_BOTTOM, WIDTH, HABITAT_H);
    shelf.lineStyle(2, 0x9fdcf5, 0.35);
    shelf.lineBetween(0, FIELD_BOTTOM + 1, WIDTH, FIELD_BOTTOM + 1);
    // A pale ice floor for the critters to stand on.
    shelf.fillStyle(0x143d88, 0.45);
    shelf.fillRect(0, HABITAT_GROUND, WIDTH, 8);
    shelf.setDepth(14);

    scene.add
      .text(20, FIELD_BOTTOM + 14, "HABITAT", {
        fontFamily: FONT,
        fontSize: "11px",
        color: "#3E5C8C",
      })
      .setDepth(15);

    this.layer = scene.add.container(0, 0).setDepth(15);
  }

  /** Adds sprites for new records and drops any that vanished. */
  sync(pets: PetRecord[]) {
    const seen = new Set(pets.map((pet) => pet.id));
    this.critters = this.critters.filter((critter) => {
      if (seen.has(critter.id)) return true;
      critter.sprite.destroy();
      return false;
    });

    pets.forEach((pet) => {
      const existing = this.critters.find((critter) => critter.id === pet.id);
      if (!existing) {
        this.critters.push(this.spawn(pet));
      } else if (existing.stage === "egg" && pet.stage === "dino") {
        this.hatch(existing);
      }
    });
  }

  private spawn(pet: PetRecord): Critter {
    const x = this.openSpot();
    const sprite = this.scene.add
      .image(x, HABITAT_GROUND, textureFor(pet))
      .setOrigin(0.5, 1)
      .setScale(0);
    sprite.setDisplaySize(...sizeFor(pet.stage));
    const target = { x: sprite.scaleX, y: sprite.scaleY };
    sprite.setScale(0);
    this.layer.add(sprite);

    this.scene.tweens.add({
      targets: sprite,
      scaleX: target.x,
      scaleY: target.y,
      duration: 340,
      ease: "Back.easeOut",
    });

    return {
      id: pet.id,
      stage: pet.stage,
      species: pet.species,
      sprite,
      activity: pet.stage === "egg" ? "idle" : "walk",
      timer: Phaser.Math.FloatBetween(1.5, 4),
      direction: Math.random() < 0.5 ? -1 : 1,
      speed: Phaser.Math.FloatBetween(11, 19),
      bob: Math.random() * Math.PI * 2,
      sleepTick: 0,
    };
  }

  /** Picks a starting x that is not already occupied, so nobody spawns stacked. */
  private openSpot() {
    let best = Phaser.Math.Between(WALK_MIN, WALK_MAX);
    let bestGap = -1;
    for (let attempt = 0; attempt < 12; attempt++) {
      const x = Phaser.Math.Between(WALK_MIN, WALK_MAX);
      const gap = this.critters.reduce(
        (min, other) => Math.min(min, Math.abs(other.sprite.x - x)),
        Number.MAX_SAFE_INTEGER,
      );
      if (gap > bestGap) {
        bestGap = gap;
        best = x;
      }
      if (gap > 70) break;
    }
    return best;
  }

  private hatch(critter: Critter) {
    const { x } = critter.sprite;
    critter.sprite.destroy();

    for (let i = 0; i < 8; i++) {
      const bit = this.scene.add
        .circle(x, HABITAT_GROUND - 14, Phaser.Math.Between(1, 3), COLORS.cream, 0.9)
        .setDepth(16);
      this.scene.tweens.add({
        targets: bit,
        x: x + Phaser.Math.Between(-26, 26),
        y: HABITAT_GROUND - Phaser.Math.Between(0, 30),
        alpha: 0,
        duration: Phaser.Math.Between(320, 620),
        ease: "Quad.easeOut",
        onComplete: () => bit.destroy(),
      });
    }

    const sprite = this.scene.add
      .image(x, HABITAT_GROUND, `dino-${critter.species}`)
      .setOrigin(0.5, 1);
    sprite.setDisplaySize(DINO_SIZE.w, DINO_SIZE.h);
    const target = { x: sprite.scaleX, y: sprite.scaleY };
    sprite.setScale(target.x * 0.2, target.y * 0.2);
    this.layer.add(sprite);
    this.scene.tweens.add({
      targets: sprite,
      scaleX: target.x,
      scaleY: target.y,
      duration: 420,
      ease: "Back.easeOut",
    });

    critter.sprite = sprite;
    critter.stage = "dino";
    critter.activity = "walk";
    critter.timer = 4;
  }

  /** Everyone perks up and hops when the player loses a ball. */
  startle() {
    this.critters.forEach((critter) => {
      if (critter.stage === "dino") {
        critter.activity = "idle";
        critter.timer = Phaser.Math.FloatBetween(0.8, 1.8);
        critter.sprite.setAngle(0);
      }
      this.scene.tweens.add({
        targets: critter.sprite,
        y: HABITAT_GROUND - 9,
        duration: 130,
        yoyo: true,
        ease: "Quad.easeOut",
      });
    });
  }

  update(dt: number) {
    this.critters.forEach((critter) => {
      critter.timer -= dt;
      if (critter.timer <= 0) this.nextActivity(critter);

      if (critter.stage === "egg") {
        // Eggs just sit and rock every so often.
        if (critter.activity === "walk") {
          critter.bob += dt * 7;
          critter.sprite.setAngle(Math.sin(critter.bob) * 7);
        } else {
          critter.sprite.setAngle(0);
        }
        return;
      }

      if (critter.activity === "walk") {
        if (this.blockedAhead(critter)) critter.direction = critter.direction === 1 ? -1 : 1;
        critter.sprite.x += critter.direction * critter.speed * dt;
        if (critter.sprite.x < WALK_MIN) {
          critter.sprite.x = WALK_MIN;
          critter.direction = 1;
        } else if (critter.sprite.x > WALK_MAX) {
          critter.sprite.x = WALK_MAX;
          critter.direction = -1;
        }
        critter.sprite.setFlipX(critter.direction === -1);
        critter.bob += dt * 9;
        critter.sprite.y = HABITAT_GROUND - Math.abs(Math.sin(critter.bob)) * 2.5;
        return;
      }

      critter.sprite.y = HABITAT_GROUND;

      if (critter.activity === "sleep") {
        critter.sleepTick -= dt;
        if (critter.sleepTick <= 0) {
          critter.sleepTick = 1.4;
          this.puffZ(critter);
        }
      }
    });
  }

  private blockedAhead(critter: Critter) {
    return this.critters.some((other) => {
      if (other === critter) return false;
      const delta = other.sprite.x - critter.sprite.x;
      return Math.sign(delta) === critter.direction && Math.abs(delta) < 34;
    });
  }

  private nextActivity(critter: Critter) {
    if (critter.stage === "egg") {
      // Idle mostly, with the occasional wobble.
      const wobbling = critter.activity === "walk";
      critter.activity = wobbling ? "idle" : "walk";
      critter.timer = wobbling ? Phaser.Math.FloatBetween(3, 7) : 0.9;
      return;
    }

    const roll = Math.random();
    if (roll < 0.5) {
      critter.activity = "walk";
      critter.timer = Phaser.Math.FloatBetween(3, 7);
      critter.direction = Math.random() < 0.5 ? -1 : 1;
      critter.sprite.setAngle(0);
    } else if (roll < 0.82) {
      critter.activity = "idle";
      critter.timer = Phaser.Math.FloatBetween(1.5, 4);
      critter.sprite.setAngle(0);
    } else {
      critter.activity = "sleep";
      critter.timer = Phaser.Math.FloatBetween(5, 11);
      critter.sleepTick = 0.4;
      this.scene.tweens.add({
        targets: critter.sprite,
        angle: critter.sprite.flipX ? 7 : -7,
        duration: 400,
        ease: "Quad.easeOut",
      });
    }
  }

  private puffZ(critter: Critter) {
    const z = this.scene.add
      .text(critter.sprite.x + 12, HABITAT_GROUND - 30, "z", {
        fontFamily: FONT,
        fontSize: "12px",
        color: "#9FDCF5",
      })
      .setDepth(16)
      .setAlpha(0.85);

    this.scene.tweens.add({
      targets: z,
      y: z.y - 20,
      x: z.x + 9,
      alpha: 0,
      duration: 1300,
      ease: "Sine.easeOut",
      onComplete: () => z.destroy(),
    });
  }
}

function textureFor(pet: PetRecord) {
  return pet.stage === "egg" ? `egg-${pet.species}` : `dino-${pet.species}`;
}

function sizeFor(stage: "egg" | "dino"): [number, number] {
  return stage === "egg" ? [EGG_SIZE.w, EGG_SIZE.h] : [DINO_SIZE.w, DINO_SIZE.h];
}
