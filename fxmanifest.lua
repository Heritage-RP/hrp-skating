--------------------------------------
--<!>-- ASTUDIOS | DEVELOPMENT --<!>--
--------------------------------------

fx_version 'adamant'

game 'gta5'

author 'Aqade_#1337'

description 'ASTUDIOS | Development - Activity: Skating'

version '1.0.0'

lua54 'yes'

shared_scripts {
  '@hrp-metrics/lib/log.lua', -- HrpLog: structured logs (PRODUCTION-SERVER docs/dev/logs.md)
  '@ox_lib/init.lua',
  'shared/*.lua',
}
client_scripts {
  'client/*.lua',
}
server_scripts {
  '@oxmysql/lib/MySQL.lua',
  'server/*.lua'
}
