--------------------------------------
--<!>-- ASTUDIOS | DEVELOPMENT --<!>--
--------------------------------------
print("^2[astudios-skating] ::^0 Started")
print("^2[astudios-skating] ::^0 Developed by ASTUDIOS | DEVELOPMENT")
if Config.Framework == "ox" then
    -- Using ox_inventory for usable items
    exports('useSkateboardItem', function(event, item, inventory, slot, data)
        local source = inventory.id
        TriggerClientEvent('astudios-skating:client:start', source, item)
    end)
    RegisterServerEvent("astudios-skating:server:skate", function()
        local source = source
        TriggerClientEvent("astudios-skating:client:skate", -1, source)
    end)
elseif Config.Framework == "qb" then
    local QBCore = exports["qb-core"]:GetCoreObject()
    QBCore.Functions.CreateUseableItem(Config.ItemName, function(source, item)
        local Player = QBCore.Functions.GetPlayer(source)
        TriggerClientEvent('astudios-skating:client:start', source, item)
    end)
    RegisterServerEvent("astudios-skating:server:skate", function(source)
        TriggerClientEvent("astudios-skating:client:skate", -1, source)
    end)
elseif Config.Framework == "esx" then
    ESX = exports["es_extended"]:getSharedObject()
    ESX.RegisterUsableItem(Config.ItemName, function(source, item)
        local Player = ESX.GetPlayerFromId(source)
        TriggerClientEvent('astudios-skating:client:start', source, item)
    end)
    RegisterServerEvent("astudios-skating:server:skate", function(source)
        TriggerClientEvent("astudios-skating:client:skate", -1, source)
    end)
end
