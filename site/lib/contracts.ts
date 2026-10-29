import {z} from 'zod';
export const boardInput=z.object({action:z.enum(['pause','login','restore','stop','accept','move']).optional(),id:z.string().max(200).optional(),paused:z.boolean().optional(),status:z.enum(['backlog','queued','done']).optional(),projectId:z.string().max(200).optional(),title:z.string().max(180).optional(),description:z.string().max(30000).optional()});
const project=z.object({id:z.string().max(200),name:z.string().max(120),path:z.string().max(1000),host:z.string().max(200)});
const window=z.object({usedPercent:z.number(),windowDurationMins:z.number(),resetsAt:z.number()});
const agent=z.object({account:z.object({type:z.string(),email:z.string().nullable().optional(),planType:z.string().nullable().optional()}).nullable(),rateLimits:z.object({primary:window.nullable().optional(),secondary:window.nullable().optional()}).optional(),authUrl:z.string().url().refine(url=>new URL(url).protocol==='https:').optional(),error:z.string().max(2000).optional()});
export const runnerInput=z.discriminatedUnion('action',[
 z.object({action:z.literal('heartbeat'),projects:z.array(project).max(100),agent}),
 z.object({action:z.literal('claim'),projectIds:z.array(z.string()).max(100)}),
 z.object({action:z.literal('report'),id:z.string(),runId:z.string(),status:z.enum(['backlog','review','done']).optional(),result:z.string().max(12000).optional(),threadId:z.string().optional(),turnId:z.string().optional()}),
 z.object({action:z.literal('state')})
]);
export const rpcInput=z.object({id:z.union([z.string(),z.number(),z.null()]).optional(),method:z.string(),params:z.object({name:z.string().optional(),arguments:z.record(z.unknown()).optional()}).passthrough().optional()});
