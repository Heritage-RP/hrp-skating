import type { BoardNetIds } from '@common/events';
import { DRIVER_MODEL, MODEL_NAME, kmh } from '@common/skate';
import { waitFor } from '@communityox/ox_lib/client';

export const MODEL = {
  /** Invisible BMX that carries the physics. */
  vehicle: GetHashKey(MODEL_NAME.vehicle),
  /** Invisible ped driving it (TASK_VEHICLE_TEMP_ACTION needs a driver). */
  driver: DRIVER_MODEL,
  /** The board prop (stream/p_defilied_ragdoll_01_s.ydr). */
  board: GetHashKey(MODEL_NAME.board),
};

/** SKEL_R_Hand */
export const RIGHT_HAND = 28422;
/** Root bone of an entity (the board prop is attached under the BMX's origin). */
const ROOT_BONE = 0;

const ENTITY_TIMEOUT = 10000;

/** The entity behind a network id, once this client knows it. */
async function entityOf(netId: number): Promise<number> {
  return waitFor(
    () => {
      if (!NetworkDoesNetworkIdExist(netId)) return undefined;
      const entity = NetworkGetEntityFromNetworkId(netId);
      return entity !== 0 && DoesEntityExist(entity) ? entity : undefined;
    },
    'skateboard entity not found',
    ENTITY_TIMEOUT,
  );
}

/** Network control of `entity` (needed to make it invisible, attach it, task its driver). */
async function control(entity: number): Promise<void> {
  await waitFor(
    () => {
      if (NetworkHasControlOfEntity(entity)) return true;
      NetworkRequestControlOfEntity(entity);
      return undefined;
    },
    'no control of the skateboard entity',
    ENTITY_TIMEOUT,
  );
}

/**
 * The board on the ground: an invisible BMX + its invisible driver, with the board prop attached under it. The three
 * entities are created and deleted by the server (#310, sv_entityLockdown); this client takes control and sets them up.
 */
export class Skateboard {
  private constructor(
    readonly vehicle: number,
    readonly board: number,
    readonly driver: number,
  ) {}

  /** Finds the server's entities, takes control of them and sets them up (once, not every loop turn). */
  static async fromNetIds(ids: BoardNetIds): Promise<Skateboard> {
    const vehicle = await entityOf(ids.vehicle);
    const board = await entityOf(ids.board);
    const driver = await entityOf(ids.driver);
    for (const entity of [vehicle, board, driver]) await control(entity);

    const playerPed = PlayerPedId();
    SetEntityNoCollisionEntity(vehicle, playerPed, false);
    SetEntityCollision(vehicle, false, true);
    SetEntityVisible(vehicle, false, false);
    SetEntityInvincible(vehicle, true);
    ForceVehicleEngineAudio(vehicle, null as unknown as string); // nil in the Lua original: no engine sound
    // Bone index on the BMX's own skeleton: a ped bone index (as in the Lua original) meant an arbitrary bone there
    AttachEntityToEntity(board, vehicle, ROOT_BONE, 0, 0, -0.4, 0, 0, 90, false, true, true, true, 1, true);

    SetEnableHandcuffs(driver, true);
    SetEntityInvincible(driver, true);
    SetEntityVisible(driver, false, false);
    FreezeEntityPosition(driver, true);
    StopCurrentPlayingAmbientSpeech(driver);
    StopPedSpeaking(driver, true);
    if (!IsPedInVehicle(driver, vehicle, false)) TaskWarpPedIntoVehicle(driver, vehicle, -1);
    await waitFor(
      () => (IsPedInVehicle(driver, vehicle, false) ? true : undefined),
      'driver not seated',
      ENTITY_TIMEOUT,
    );

    return new Skateboard(vehicle, board, driver);
  }

  exists(): boolean {
    return DoesEntityExist(this.vehicle) && DoesEntityExist(this.driver);
  }

  /** Lets go of the board (detached from the hand); the server deletes its entities when the item comes back. */
  release(): void {
    if (DoesEntityExist(this.vehicle)) DetachEntity(this.vehicle, false, false);
  }

  coords(): number[] {
    return GetEntityCoords(this.vehicle, false);
  }

  /** km/h */
  speed(): number {
    return kmh(GetEntitySpeed(this.vehicle));
  }

  pitch(): number {
    return GetEntityRotation(this.vehicle, 0)[0];
  }

  inAir(): boolean {
    return IsEntityInAir(this.vehicle);
  }

  velocity(): number[] {
    return GetEntityVelocity(this.vehicle);
  }

  setVelocity(x: number, y: number, z: number): void {
    SetEntityVelocity(this.vehicle, x, y, z);
  }

  /** TASK_VEHICLE_TEMP_ACTION on the invisible driver. */
  drive(action: number, time: number): void {
    TaskVehicleTempAction(this.driver, this.vehicle, action, time);
  }

  requestControl(): void {
    if (!NetworkHasControlOfEntity(this.driver)) NetworkRequestControlOfEntity(this.driver);
    else if (!NetworkHasControlOfEntity(this.vehicle)) NetworkRequestControlOfEntity(this.vehicle);
  }

  /** Holds the board in the ped's right hand (put down / picked up animation). */
  attachToHand(ped: number): void {
    AttachEntityToEntity(
      this.vehicle,
      ped,
      GetPedBoneIndex(ped, RIGHT_HAND),
      -0.1,
      0,
      -0.2,
      70,
      0,
      270,
      true,
      true,
      false,
      false,
      2,
      true,
    );
  }
}
