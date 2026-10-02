--------------------------------------
--<!>-- ASTUDIOS | DEVELOPMENT --<!>--
--------------------------------------
print("^2[astudios-skating] ::^0 Started")
print("^2[astudios-skating] ::^0 Developed by ASTUDIOS | DEVELOPMENT")

-- Framework Adapters (Single Responsibility + Open/Closed Principle)
local FrameworkAdapter = {}

FrameworkAdapter.ox = {
    init = function()
        return exports.ox_inventory
    end,
    -- Returns true only when the item was actually removed (the Lua export returns `true` or `false, reason`)
    removeItem = function(source, itemName, slot)
        return exports.ox_inventory:RemoveItem(source, itemName, 1, nil, slot) == true
    end,
    addItem = function(source, itemName)
        exports.ox_inventory:AddItem(source, itemName, 1)
    end,
    registerUsableItem = function(itemName, callback)
        -- ox_inventory calls it as (event, item, inventory, slot, data); with `consume = 0` only 'usingItem' is sent.
        -- Returning false cancels ox_inventory's own use flow: the board has already been taken out of the slot.
        exports('useSkateboardItem', function(event, item, inventory, slot, data)
            if event ~= 'usingItem' then return end
            if inventory and type(inventory.id) == 'number' then
                callback(inventory.id, item, slot)
            end
            return false
        end)
    end
}

FrameworkAdapter.qb = {
    init = function()
        return exports["qb-core"]:GetCoreObject()
    end,
    removeItem = function(source, itemName, slot)
        local QBCore = exports["qb-core"]:GetCoreObject()
        local Player = QBCore.Functions.GetPlayer(source)
        return Player ~= nil and Player.Functions.RemoveItem(itemName, 1, slot) ~= false
    end,
    addItem = function(source, itemName)
        local QBCore = exports["qb-core"]:GetCoreObject()
        local Player = QBCore.Functions.GetPlayer(source)
        if Player then
            Player.Functions.AddItem(itemName, 1)
        end
    end,
    registerUsableItem = function(itemName, callback)
        local QBCore = exports["qb-core"]:GetCoreObject()
        QBCore.Functions.CreateUseableItem(itemName, function(source, item)
            callback(source, item, nil)
        end)
    end
}

FrameworkAdapter.esx = {
    init = function()
        return exports["es_extended"]:getSharedObject()
    end,
    removeItem = function(source, itemName, slot)
        local ESX = exports["es_extended"]:getSharedObject()
        local Player = ESX.GetPlayerFromId(source)
        if not Player then return false end
        Player.removeInventoryItem(itemName, 1)
        return true
    end,
    addItem = function(source, itemName)
        local ESX = exports["es_extended"]:getSharedObject()
        local Player = ESX.GetPlayerFromId(source)
        if Player then
            Player.addInventoryItem(itemName, 1)
        end
    end,
    registerUsableItem = function(itemName, callback)
        local ESX = exports["es_extended"]:getSharedObject()
        ESX.RegisterUsableItem(itemName, function(source, item)
            callback(source, item, nil)
        end)
    end
}

-- Skating Service (Dependency Inversion Principle)
local SkatingService = {}

function SkatingService:new(adapter)
    -- deployed[source] = true while that player's board is out of their inventory (one board at a time)
    local instance = { adapter = adapter, deployed = {} }
    setmetatable(instance, { __index = self })
    return instance
end

function SkatingService:useItem(source, item, slot)
    if self.deployed[source] then return end
    if not self.adapter.removeItem(source, Config.ItemName, slot) then return end
    self.deployed[source] = true
    TriggerClientEvent('astudios-skating:client:start', source, item)
end

-- Gives the board back only to a player who has one out: the client can't create skateboards.
function SkatingService:giveItem(source)
    if not self.deployed[source] then return end
    self.deployed[source] = nil
    self.adapter.addItem(source, Config.ItemName)
end

-- The board is lost with the player (no inventory to put it back into).
function SkatingService:forget(source)
    self.deployed[source] = nil
end

-- Resource stop: every board out is put back in its owner's inventory.
function SkatingService:returnAll()
    for source in pairs(self.deployed) do
        self:giveItem(source)
    end
end

-- Initialize the correct adapter (Interface Segregation)
local adapter = FrameworkAdapter[Config.Framework]
if not adapter then
    print("^1[astudios-skating] ::^0 Unsupported framework: " .. tostring(Config.Framework))
    return
end

local skatingService = SkatingService:new(adapter)

-- Register usable item
adapter.registerUsableItem(Config.ItemName, function(source, item, slot)
    skatingService:useItem(source, item, slot)
end)

-- Register server events
RegisterNetEvent("astudios-skating:server:giveItem", function()
    local source = source
    skatingService:giveItem(source)
end)

AddEventHandler('playerDropped', function()
    skatingService:forget(source)
end)

AddEventHandler('onResourceStop', function(resourceName)
    if resourceName ~= GetCurrentResourceName() then return end
    skatingService:returnAll()
end)
