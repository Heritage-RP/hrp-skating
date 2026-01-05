--------------------------------------
--<!>-- ASTUDIOS | DEVELOPMENT --<!>--
--------------------------------------

-- ============================================
-- NOTIFICATION ADAPTER (Open/Closed Principle)
-- ============================================
local NotificationAdapter = {}

NotificationAdapter.ox = function(message)
    lib.notify({ title = 'Skateboard', description = message, type = 'inform' })
end

NotificationAdapter.qb = function(message)
    local QBCore = exports["qb-core"]:GetCoreObject()
    QBCore.Functions.Notify(message, "primary")
end

NotificationAdapter.esx = function(message)
    local ESX = exports["es_extended"]:getSharedObject()
    ESX.ShowNotification(message)
end

-- Get the appropriate notification function
local notify = NotificationAdapter[Config.Framework]
if not notify then
    print("^1[astudios-skating] ::^0 Unsupported framework: " .. tostring(Config.Framework))
    return
end

-- ============================================
-- CONSTANTS (Single Source of Truth)
-- ============================================
local Controls = {
    FORWARD = 32,
    BACKWARD = 33,
    LEFT = 34,
    RIGHT = 35,
    PICKUP = 38,
    MOUNT = 113,
    JUMP = 22
}

local Models = {
    VEHICLE = GetHashKey("bmx"),
    PED = 68070371,
    BOARD = GetHashKey("p_defilied_ragdoll_01_s")
}

local Animations = {
    PICKUP = { dict = "pickup_object", name = "pickup_low" },
    IDLE = { dict = "move_strafe@stealth", name = "idle" },
    CROUCH = { dict = "move_crouch_proto", name = "idle_intro" }
}

-- ============================================
-- MODEL LOADER (Single Responsibility)
-- ============================================
local ModelLoader = {}
ModelLoader.loaded = {}

function ModelLoader:load(assets)
    for _, asset in ipairs(assets) do
        table.insert(self.loaded, asset)
        if IsModelValid(asset) then
            RequestModel(asset)
            while not HasModelLoaded(asset) do Wait(10) end
        else
            RequestAnimDict(asset)
            while not HasAnimDictLoaded(asset) do Wait(10) end
        end
    end
end

function ModelLoader:unload()
    for _, asset in ipairs(self.loaded) do
        if IsModelValid(asset) then
            SetModelAsNoLongerNeeded(asset)
        else
            RemoveAnimDict(asset)
        end
    end
    self.loaded = {}
end

-- ============================================
-- INPUT HANDLER (Single Responsibility)
-- ============================================
local InputHandler = {}

function InputHandler:getMovementState()
    return {
        forward = IsControlPressed(0, Controls.FORWARD),
        backward = IsControlPressed(0, Controls.BACKWARD),
        left = IsControlPressed(0, Controls.LEFT),
        right = IsControlPressed(0, Controls.RIGHT)
    }
end

function InputHandler:isPickupPressed()
    return IsControlJustPressed(0, Controls.PICKUP)
end

function InputHandler:isMountReleased()
    return IsControlJustReleased(0, Controls.MOUNT)
end

function InputHandler:isJumpPressed()
    return IsControlPressed(0, Controls.JUMP)
end

function InputHandler:isMovementReleased()
    return IsControlJustReleased(0, Controls.FORWARD) or IsControlJustReleased(0, Controls.BACKWARD)
end

-- ============================================
-- MOVEMENT CONTROLLER (Single Responsibility)
-- ============================================
local MovementController = {}

-- Vehicle temp action codes
local Actions = {
    IDLE = 1,
    STOP = 3,
    TURN_LEFT = 4,
    TURN_RIGHT = 5,
    BRAKE = 6,
    FORWARD_LEFT = 7,
    FORWARD_RIGHT = 8,
    FORWARD = 9,
    BACKWARD_LEFT = 13,
    BACKWARD_RIGHT = 14,
    BACKWARD = 22,
    HANDBRAKE = 30
}

function MovementController:handleMovement(driverPed, vehicle, movement, overSpeed)
    if overSpeed then return end
    
    local action = nil
    
    if movement.forward and movement.backward then
        action = Actions.HANDBRAKE
        TaskVehicleTempAction(driverPed, vehicle, action, 100)
        return
    end
    
    if movement.forward then
        if movement.left then
            action = Actions.FORWARD_LEFT
        elseif movement.right then
            action = Actions.FORWARD_RIGHT
        else
            action = Actions.FORWARD
        end
    elseif movement.backward then
        if movement.left then
            action = Actions.BACKWARD_LEFT
        elseif movement.right then
            action = Actions.BACKWARD_RIGHT
        else
            action = Actions.BACKWARD
        end
    elseif movement.left then
        action = Actions.TURN_LEFT
    elseif movement.right then
        action = Actions.TURN_RIGHT
    end
    
    if action then
        TaskVehicleTempAction(driverPed, vehicle, action, 1)
    end
end

-- ============================================
-- ANIMATION CONTROLLER (Single Responsibility)
-- ============================================
local AnimationController = {}

function AnimationController:play(ped, anim, blendIn, blendOut, duration, flag, playbackRate)
    blendIn = blendIn or 8.0
    blendOut = blendOut or -8.0
    duration = duration or -1
    flag = flag or 0
    playbackRate = playbackRate or 0
    TaskPlayAnim(ped, anim.dict, anim.name, blendIn, blendOut, duration, flag, playbackRate, false, false, false)
end

function AnimationController:stop(ped, anim, blendOut)
    blendOut = blendOut or 1.0
    StopAnimTask(ped, anim.dict, anim.name, blendOut)
end

-- ============================================
-- SKATEBOARD ENTITY (Single Responsibility)
-- ============================================
local SkateboardEntity = {
    vehicle = nil,
    board = nil,
    driverPed = nil
}

function SkateboardEntity:exists()
    return DoesEntityExist(self.vehicle)
end

function SkateboardEntity:create(coords, heading)
    self.vehicle = CreateVehicle(Models.VEHICLE, coords, heading, true)
    self.board = CreateObject(Models.BOARD, 0.0, 0.0, 0.0, true, true, true)
    
    while not DoesEntityExist(self.vehicle) do Wait(5) end
    while not DoesEntityExist(self.board) do Wait(5) end
    
    local playerPed = PlayerPedId()
    SetEntityNoCollisionEntity(self.vehicle, playerPed, false)
    SetEntityCollision(self.vehicle, false, true)
    SetEntityVisible(self.vehicle, false)
    AttachEntityToEntity(self.board, self.vehicle, GetPedBoneIndex(playerPed, 28422), 
        0.0, 0.0, -0.40, 0.0, 0.0, 90.0, false, true, true, true, 1, true)
    
    self.driverPed = CreatePed(12, Models.PED, coords, heading, true, true)
    SetEnableHandcuffs(self.driverPed, true)
    SetEntityInvincible(self.driverPed, true)
    SetEntityVisible(self.driverPed, false)
    FreezeEntityPosition(self.driverPed, true)
    TaskWarpPedIntoVehicle(self.driverPed, self.vehicle, -1)
    
    while not IsPedInVehicle(self.driverPed, self.vehicle) do Wait(0) end
end

function SkateboardEntity:destroy()
    DetachEntity(self.vehicle)
    DeleteEntity(self.board)
    DeleteVehicle(self.vehicle)
    DeleteEntity(self.driverPed)
    self.vehicle = nil
    self.board = nil
    self.driverPed = nil
end

function SkateboardEntity:getCoords()
    return GetEntityCoords(self.vehicle)
end

function SkateboardEntity:getSpeed()
    return GetEntitySpeed(self.vehicle) * 3.6
end

function SkateboardEntity:getRotation()
    return GetEntityRotation(self.vehicle)
end

function SkateboardEntity:isInAir()
    return IsEntityInAir(self.vehicle)
end

function SkateboardEntity:setVelocity(x, y, z)
    SetEntityVelocity(self.vehicle, x, y, z)
end

function SkateboardEntity:getVelocity()
    return GetEntityVelocity(self.vehicle)
end

function SkateboardEntity:requestControl()
    if not NetworkHasControlOfEntity(self.driverPed) then
        NetworkRequestControlOfEntity(self.driverPed)
    elseif not NetworkHasControlOfEntity(self.vehicle) then
        NetworkRequestControlOfEntity(self.vehicle)
    end
end

-- ============================================
-- SKATING SERVICE (Dependency Inversion)
-- ============================================
local SkatingService = {
    connected = false,
    speed = 0,
    player = nil
}

function SkatingService:init()
    self.player = PlayerPedId()
    self.connected = false
    self.speed = 0
end

function SkatingService:shouldRagdoll()
    local rotation = SkateboardEntity:getRotation()
    local x = rotation.x
    
    if ((-60.0 < x and x > 60.0)) and SkateboardEntity:isInAir() and self.speed < 5.0 then
        return true
    end
    if HasEntityCollidedWithAnything(self.player) and self.speed > 5.0 then
        return true
    end
    if IsPedDeadOrDying(self.player, false) then
        return true
    end
    return false
end

function SkatingService:connectPlayer(toggle)
    if toggle then
        AnimationController:play(self.player, Animations.IDLE, 8.0, 8.0, -1, 1, 1.0)
        AttachEntityToEntity(self.player, SkateboardEntity.vehicle, 20, 
            0.0, 0, 0.7, 0.0, 0.0, -15.0, true, true, false, true, 1, true)
        SetEntityCollision(self.player, true, true)
        TriggerServerEvent("astudios-skating:server:skate")
    else
        DetachEntity(self.player, false, false)
        AnimationController:stop(self.player, Animations.IDLE)
        AnimationController:stop(PlayerPedId(), Animations.CROUCH)
        TaskVehicleTempAction(SkateboardEntity.driverPed, SkateboardEntity.vehicle, 3, 1)
    end
    self.connected = toggle
end

function SkatingService:handleJump()
    if not InputHandler:isJumpPressed() or not self.connected then return end
    if SkateboardEntity:isInAir() then return end
    
    local vel = SkateboardEntity:getVelocity()
    AnimationController:play(PlayerPedId(), Animations.CROUCH, 5.0, 8.0, -1, 0, 0)
    
    local duration = 0
    while InputHandler:isJumpPressed() do
        Wait(10)
        duration = duration + 10.0
    end
    
    local boosting = math.min(Config.maxJumpHeigh * duration / 250.0, Config.maxJumpHeigh)
    AnimationController:stop(PlayerPedId(), Animations.CROUCH)
    
    if self.connected then
        SkateboardEntity:setVelocity(vel.x, vel.y, vel.z + boosting)
        AnimationController:play(self.player, Animations.IDLE, 8.0, 2.0, -1, 1, 1.0)
    end
end

function SkatingService:placeSkateboard()
    if not SkateboardEntity:exists() then return end
    
    local ped = PlayerPedId()
    AttachEntityToEntity(SkateboardEntity.vehicle, ped, GetPedBoneIndex(ped, 28422),
        -0.1, 0.0, -0.2, 70.0, 0.0, 270.0, 1, 1, 0, 0, 2, 1)
    AnimationController:play(ped, Animations.PICKUP)
    Wait(800)
    DetachEntity(SkateboardEntity.vehicle, false, true)
    PlaceObjectOnGroundProperly(SkateboardEntity.vehicle)
    notify(Config.Language.Info['controls'])
end

function SkatingService:pickupSkateboard()
    if not SkateboardEntity:exists() then return end
    
    local ped = PlayerPedId()
    AnimationController:play(ped, Animations.PICKUP)
    Wait(600)
    AttachEntityToEntity(SkateboardEntity.vehicle, ped, GetPedBoneIndex(ped, 28422),
        -0.1, 0.0, -0.2, 70.0, 0.0, 270.0, 1, 1, 0, 0, 2, 1)
    Wait(900)
    self:clear()
    TriggerServerEvent("astudios-skating:server:giveItem")
end

function SkatingService:clear()
    SkateboardEntity:destroy()
    ModelLoader:unload()
    self.connected = false
    SetPedRagdollOnCollision(self.player, false)
end

function SkatingService:handleKeys(distance)
    local movement = InputHandler:getMovementState()
    
    -- Handle pickup/mount when close enough
    if distance <= 1.5 then
        if InputHandler:isPickupPressed() then
            self:pickupSkateboard()
            return
        elseif InputHandler:isMountReleased() then
            if self.connected then
                self:connectPlayer(false)
            elseif not IsPedRagdoll(self.player) then
                Wait(200)
                self:connectPlayer(true)
            end
        end
    end
    
    if distance >= Config.LoseConnectionDistance then return end
    
    local overSpeed = SkateboardEntity:getSpeed() > Config.MaxSpeedKmh
    TaskVehicleTempAction(SkateboardEntity.driverPed, SkateboardEntity.vehicle, 1, 1)
    ForceVehicleEngineAudio(SkateboardEntity.vehicle, 0)
    
    CreateThread(function()
        self.player = PlayerPedId()
        Wait(1)
        SetEntityInvincible(SkateboardEntity.vehicle, true)
        StopCurrentPlayingAmbientSpeech(SkateboardEntity.driverPed)
        
        if self.connected then
            self.speed = SkateboardEntity:getSpeed()
            if self:shouldRagdoll() then
                self:connectPlayer(false)
                SetPedToRagdoll(self.player, 5000, 4000, 0, true, true, false)
                self.connected = false
            end
        end
    end)
    
    -- Handle movement
    MovementController:handleMovement(SkateboardEntity.driverPed, SkateboardEntity.vehicle, movement, overSpeed)
    
    -- Handle brake on release
    if InputHandler:isMovementReleased() and not overSpeed then
        TaskVehicleTempAction(SkateboardEntity.driverPed, SkateboardEntity.vehicle, 6, 2500)
    end
    
    -- Handle jump
    self:handleJump()
end

function SkatingService:spawn()
    local assetsToLoad = {
        Models.VEHICLE,
        Models.PED,
        Models.BOARD,
        Animations.PICKUP.dict,
        Animations.IDLE.dict,
        Animations.CROUCH.dict
    }
    ModelLoader:load(assetsToLoad)
    
    local ped = PlayerPedId()
    local spawnCoords = GetEntityCoords(ped) + GetEntityForwardVector(ped) * 2.0
    local spawnHeading = GetEntityHeading(ped)
    
    SkateboardEntity:create(spawnCoords, spawnHeading)
    self:placeSkateboard()
end

function SkatingService:start()
    if SkateboardEntity:exists() then return end
    
    self:init()
    self:spawn()
    
    while SkateboardEntity:exists() and DoesEntityExist(SkateboardEntity.driverPed) do
        Wait(5)
        local playerCoords = GetEntityCoords(PlayerPedId())
        local boardCoords = SkateboardEntity:getCoords()
        local distance = #(playerCoords - boardCoords)
        
        self:handleKeys(distance)
        
        if distance <= Config.LoseConnectionDistance then
            SkateboardEntity:requestControl()
        else
            TaskVehicleTempAction(SkateboardEntity.driverPed, SkateboardEntity.vehicle, 6, 2500)
        end
    end
end

-- ============================================
-- EVENT REGISTRATION
-- ============================================
RegisterNetEvent("astudios-skating:client:start", function()
    SkatingService:start()
end)

RegisterNetEvent("astudios-skating:client:skate", function(id)
    local player = GetPlayerFromServerId(id)
    local vehicle = GetEntityAttachedTo(GetPlayerPed(player))
end)
