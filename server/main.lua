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
    removeItem = function(source, itemName, slot)
        exports.ox_inventory:RemoveItem(source, itemName, 1, nil, slot)
    end,
    addItem = function(source, itemName)
        exports.ox_inventory:AddItem(source, itemName, 1)
    end,
    registerUsableItem = function(itemName, callback)
        exports('useSkateboardItem', function(event, item, inventory, slot, data)
            callback(inventory.id, item, slot)
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
        if Player then
            Player.Functions.RemoveItem(itemName, 1, slot)
        end
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
        if Player then
            Player.removeInventoryItem(itemName, 1)
        end
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
    local instance = { adapter = adapter }
    setmetatable(instance, { __index = self })
    return instance
end

function SkatingService:useItem(source, item, slot)
    self.adapter.removeItem(source, Config.ItemName, slot)
    TriggerClientEvent('astudios-skating:client:start', source, item)
end

function SkatingService:giveItem(source)
    self.adapter.addItem(source, Config.ItemName)
end

function SkatingService:broadcastSkate(source)
    TriggerClientEvent("astudios-skating:client:skate", -1, source)
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

RegisterServerEvent("astudios-skating:server:skate", function()
    local source = source
    skatingService:broadcastSkate(source)
end)
