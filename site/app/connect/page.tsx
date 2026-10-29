import {requireChatGPTUser} from '../chatgpt-auth';
export const dynamic='force-dynamic';
export default async function Connect({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
 const p=await searchParams;const port=Number(p.port),state=p.state??'';
 await requireChatGPTUser(`/connect?port=${port}&state=${encodeURIComponent(state)}`);
 if(!Number.isInteger(port)||port<1024||port>65535||!/^[a-f0-9]{64}$/.test(state))return <main className="connect-page"><h1>Откройте подключение из локального агента</h1><a href="/">Вернуться к доске</a></main>;
 return <main className="connect-page"><span className="codex-logo"/><h1>Подключить этот компьютер?</h1><p>Локальный агент получит доступ к вашей доске и будет выполнять задачи в проектах Codex на этом компьютере.</p><form method="POST" action="/api/connect" target="_top"><input type="hidden" name="port" value={port}/><input type="hidden" name="state" value={state}/><button className="primary-button full" type="submit">Подключить</button></form><a href="/">Отмена</a></main>;
}
