import {z} from 'zod';
export const boardInput=z.object({action:z.enum(['pause','login','restore','stop','accept','move','hideProject','restoreProject','answer']).optional(),id:z.string().max(200).optional(),questionId:z.string().max(200).optional(),answer:z.string().max(8000).optional(),paused:z.boolean().optional(),status:z.enum(['backlog','queued','done']).optional(),projectId:z.string().max(200).optional(),title:z.string().max(180).optional(),description:z.string().max(30000).optional(),model:z.string().min(1).max(160).nullable().optional(),effort:z.string().min(1).max(40).nullable().optional(),attachmentKeys:z.array(z.string().max(300)).max(8).optional()});
const project=z.object({id:z.string().max(200),name:z.string().max(120),path:z.string().max(1000),host:z.string().max(200)});
const window=z.object({usedPercent:z.number(),windowDurationMins:z.number(),resetsAt:z.number()});
const model=z.object({id:z.string().max(160),name:z.string().max(160),efforts:z.array(z.string().max(40)).max(12),defaultEffort:z.string().max(40).nullable(),isDefault:z.boolean(),inputModalities:z.array(z.string().max(40)).max(10)});
const agent=z.object({models:z.array(model).max(100).optional(),account:z.object({type:z.string(),email:z.string().nullable().optional(),planType:z.string().nullable().optional()}).nullable(),rateLimits:z.object({primary:window.nullable().optional(),secondary:window.nullable().optional()}).optional(),authUrl:z.string().url().refine(url=>new URL(url).protocol==='https:').optional(),error:z.string().max(2000).optional()});
export const runnerInput=z.discriminatedUnion('action',[
 z.object({action:z.literal('heartbeat'),projects:z.array(project).max(100),agent}),
 z.object({action:z.literal('claim'),projectIds:z.array(z.string()).max(100),capabilities:z.array(z.string().max(80)).max(20).optional()}),
 z.object({action:z.literal('report'),id:z.string(),runId:z.string(),status:z.enum(['backlog','review','done']).optional(),result:z.string().max(12000).optional(),threadId:z.string().optional(),turnId:z.string().optional()}),
 z.object({action:z.literal('question'),id:z.string(),runId:z.string(),question:z.object({id:z.string().min(1).max(200),prompt:z.string().trim().min(1).max(4000)})}),
 z.object({action:z.literal('state')})
]);
export const rpcInput=z.object({id:z.union([z.string(),z.number(),z.null()]).optional(),method:z.string(),params:z.object({name:z.string().optional(),arguments:z.record(z.unknown()).optional()}).passthrough().optional()});
