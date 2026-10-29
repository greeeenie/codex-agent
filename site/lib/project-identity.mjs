export function projectIdentity(project){
 let value=project.path.trim();
 if(/^[a-z]:[\\/]|^\\\\/i.test(value))value=value.replaceAll('\\','/').toLowerCase();
 value=value.replace(/\/+$/,'')||'/';
 return JSON.stringify([project.host??'local',value]);
}
