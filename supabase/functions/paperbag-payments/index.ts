import {createHandler} from './index.mjs';
Deno.serve(createHandler(name=>Deno.env.get(name)));
