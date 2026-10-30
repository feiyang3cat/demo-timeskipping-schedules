import { listRequests } from './database';

// Read the same SQLite database written by the Worker Activities.
console.log(JSON.stringify(listRequests(process.argv[2]), null, 2));
