import { kmh } from '@common/skate';
import { waitFor } from '@communityox/ox_lib/client';

export const MODEL = {
  /** Invisible BMX that carries the physics. */
  vehicle: GetHashKey('bmx'),
  /** Invisible ped driving it (TASK_VEHICLE_TEMP_ACTION needs a driver). */
  driver: 68070371,
  /** The board prop (stream/p_defilied_ragdoll_01_s.ydr). */
  board: GetHashKey('p_defilied_ragdoll_01_s'),
};

/** SKEL_R_Hand */
export const RIGHT_HAND = 28422;

const ENTITY_TIMEOUT = 10000;

async function waitExists(entity: number): Promise<void> {
  await waitFor(() => (DoesEntityExist(entity) ? true : undefined), 'skateboard entity not created', ENTITY_TIMEOUT);
}

/** The board on the ground: an invisible BMX + its invisible driver, with the board prop attached under it. */
export class Skateboard {
  private constructor(
    readonly vehicle: number,
    readonly board: number,
    readonly driver: number,
  ) {}

  /** Models must be loaded. */
  static async create(x: number, y: number, z: number, heading: number): Promise<Skateboard> {
    const vehicle = CreateVehicle(MODEL.vehicle, x, y, z, heading, true, false);
    const board = CreateObject(MODEL.board, 0, 0, 0, true, true, true);
    let driver = 0;
    try {
      return await Skateboard.assemble(vehicle, board, () => {
        driver = CreatePed(12, MODEL.driver, x, y, z, heading, true, true);
        return driver;
      });
    } catch (err) {
      new Skateboard(vehicle, board, driver).destroy();
      throw err;
    }
  }

  private static async assemble(vehicle: number, board: number, spawnDriver: () => number): Promise<Skateboard> {
    await waitExists(vehicle);
    await waitExists(board);

    const playerPed = PlayerPedId();
    SetEntityNoCollisionEntity(vehicle, playerPed, false);
    SetEntityCollision(vehicle, false, true);
    SetEntityVisible(vehicle, false, false);
    AttachEntityToEntity(
      board,
      vehicle,
      GetPedBoneIndex(playerPed, RIGHT_HAND),
      0,
      0,
      -0.4,
      0,
      0,
      90,
      false,
      true,
      true,
      true,
      1,
      true,
    );

    const driver = spawnDriver();
    await waitExists(driver);
    SetEnableHandcuffs(driver, true);
    SetEntityInvincible(driver, true);
    SetEntityVisible(driver, false, false);
    FreezeEntityPosition(driver, true);
    TaskWarpPedIntoVehicle(driver, vehicle, -1);
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

  destroy(): void {
    if (DoesEntityExist(this.vehicle)) DetachEntity(this.vehicle, false, false);
    if (DoesEntityExist(this.board)) DeleteEntity(this.board);
    if (DoesEntityExist(this.vehicle)) DeleteVehicle(this.vehicle);
    if (DoesEntityExist(this.driver)) DeleteEntity(this.driver);
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
