export function startDictation(Recognition,{text,onText,onListening,onError}){
 if(!Recognition){onError('В этом браузере нет распознавания речи. Откройте доску в Chrome или Edge.');return null;}
 const recognition=new Recognition();let disposed=false;
 recognition.lang='ru-RU';recognition.continuous=true;recognition.interimResults=true;
 recognition.onresult=event=>{let transcript='';for(let i=0;i<event.results.length;i++)transcript+=event.results[i][0].transcript+' ';onText([text.trimEnd(),transcript.trim()].filter(Boolean).join(' ').slice(0,30000));};
 recognition.onerror=event=>{if(disposed)return;const messages={'not-allowed':'Разрешите доступ к микрофону в настройках браузера.','service-not-allowed':'Распознавание речи недоступно в этом браузере.','audio-capture':'Микрофон не найден.','no-speech':'Речь не распознана. Попробуйте ещё раз.','network':'Нет соединения со службой распознавания речи.','language-not-supported':'Браузер не поддерживает распознавание на русском.'};if(event.error!=='aborted')onError(messages[event.error]??'Не удалось включить голосовой ввод.');onListening(false);};
 recognition.onend=()=>{if(!disposed)onListening(false);};
 try{recognition.start();onListening(true);}catch{onError('Не удалось включить голосовой ввод.');onListening(false);return null;}
 return {stop:()=>recognition.stop(),dispose:()=>{disposed=true;recognition.onresult=null;recognition.onerror=null;recognition.onend=null;recognition.abort();}};
}
