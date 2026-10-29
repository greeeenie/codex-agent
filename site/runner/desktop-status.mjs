export function status(state,message){if(process.argv.includes('--desktop'))process.stdout.write(JSON.stringify({event:'status',state,message})+'\n');}
