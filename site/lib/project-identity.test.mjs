import test from 'node:test';import assert from 'node:assert/strict';import {projectIdentity} from './project-identity.mjs';
test('matches Windows project paths across recreated ids, case, and separators',()=>{
 assert.equal(projectIdentity({id:'old',path:'C:/Users/Me/Projects/Board/',host:'local'}),projectIdentity({id:'new',path:'c:\\users\\me\\projects\\board',host:'local'}));
});
test('keeps distinct hosts and case-sensitive POSIX paths separate',()=>{
 assert.notEqual(projectIdentity({path:'/repo/Board',host:'a'}),projectIdentity({path:'/repo/board',host:'a'}));
 assert.notEqual(projectIdentity({path:'C:/Board',host:'a'}),projectIdentity({path:'C:/Board',host:'b'}));
});
