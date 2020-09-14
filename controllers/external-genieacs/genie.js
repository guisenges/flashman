/*
Set of functions that will handle the communication from flashman to genieacs 
through the use of genieacs-nbi, the genie rest api.
*/

const http = require('http');
const mongodb = require('mongodb')
const sio = require('../../sio')


let GENIEHOST = 'localhost'
let GENIEPORT = 7557

let genie = {} // to be exported.

// starting a connection to mongodb so we can start a change stream to the tasks collection when necessary.
let tasksCollection
mongodb.MongoClient.connect('mongodb://localhost:27017', 
  {useUnifiedTopology: true}).then(async client => {
  tasksCollection = client.db('genieacs').collection('tasks')
  // await run().catch(e => console.log(e)) // function for debugging
  // client.close() //  we should never close connection to database. it will be close when application stops.
})

if (Promise.allSettled === undefined) { // if allSettled is not defined in Promise, we define it here.
  Promise.allSettled = function allSettled(promises) {
    let wrappedPromises = promises.map(p => Promise.resolve(p)
        .then(
            val => ({ status: 'fulfilled', value: val }),
            err => ({ status: 'rejected', reason: err })));
    return Promise.all(wrappedPromises);
  }
}

/* promisifying a nodejs http request. 'options' are the http.request option as defined by nodejs api. 'body' is the content 
of the request (should be a string) and it up to the caller to set the correct header in case body is used.*/
const request = (options, body) => {
  return new Promise((resolve, reject) => {
    let req = http.request(options, res => {
      res.setEncoding('utf8')
      res.data = ''
      res.on('data', chunk => res.data+=chunk)
      res.on('end', _ => resolve(res))
    })
    req.on('error', reject)
    if (body !== undefined && body.constructor === String) req.write(body)
    req.end()
  })
}

/* simple request to send a new task to GenieACS and get a promise the resolves to the request response or rejects to 
request error. Will throw an uncaught error if task can't be stringifyed to json. */
function postTask (deviceid, task, timeout, shouldRequestConnection) {
  let taskstring = JSON.stringify(task) // can throw an error here.
  return request({ 
    method: "POST", hostname: GENIEHOST, port: GENIEPORT,
    path: '/devices/'+deviceid+'/tasks?timeout='+timeout+(shouldRequestConnection ? '&connection_request' : ''),
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(taskstring)}
  }, taskstring)
}

/* simple request to delete a task, by its id, in GenieACS and get a promise the resolves to the request response or rejects 
to request error.  */
function deleteTask (taskid) {
  return request({ method: 'DELETE', hostname: GENIEHOST, port: GENIEPORT, path: '/tasks/'+taskid })
}

/* a map structure that holds task attribute names where the keys are the task names and the values are the task 
parameters respected to the task name. */
let taskParameterIdFromType = {
  getParameterValues: "parameterNames", setParameterValues: "parameterValues",
  refreshObject: "objectName", addObject: "objectName", download: "file",
}

/* return true if task has the correct format or false otherwise. 'task' should be a javascript object. refer to 
https://github.com/genieacs/genieacs/wiki/API-Reference#tasks to understand a task format.*/
function checkTask (task) {
  let name = task.name // the task name/type.
  let parameterId = taskParameterIdFromType[name] // the attribute name where a task holds its parameters.
  if (parameterId === undefined) return false // task name/type has to be defined in 'taskParameterIdFromType'.
  if (name === "setParameterValues") { // in case task name/type is "setParameterValues".
    if (task[parameterId].constructor !== Array) return false // its parameter has to be an array.
    for (let i = 0; i < task[parameterId].length; i++) { // and for each value in that array.
      if (task[parameterId][i].constructor !== Array) return false // that value has also to be an array.
      if (task[parameterId][i].length !== 2) return false // that sub array has to have length 2.
      if (task[parameterId][i][0].constructor !== String // first position has to be a string (tr069 parameter name).
          || (task[parameterId][i][1].constructor !== String // second position can be a string, a number or a boolean.
              && task[parameterId][i][1].constructor !== Number
              && task[parameterId][i][1].constructor !== Boolean)
          ) return false
    }
  } else if (name === "getParameterValues" ) { // in case task name/type is "getParameterValues".
    if (task[parameterId].constructor !== Array) return false // its parameter has to be an array.
    for (let i = 0; i < task[parameterId].length; i++) { // and for each value in that array.
      if (task[parameterId][i].constructor !== String) return false // that value has to be a string (tr069 parameter name).
    }
  } else if (task[parameterId].constructor !== String) { // all other task names/types have a string as parameter.
    return false
  }
  return true // if all passed, this task is good.
}

/* given an array of tasks, ignores tasks the can't be joined (the one which parameters data type aren't an array) and 
returns a array in which the first position has an array tasks that will be new tasks sent to genie and the second position 
has an object where key is a task type/name and the value is an array of task ids to be deleted. It's implicit that all 
tasks belong to the same device id.
The tasks to be delete are tasks that have the same name/type. All tasks with the same name/type are returned in the second 
argument. Tasks are not check for being identical, in that case all identical tasks are marked to be removed and new 
identical task is created.
The tasks to be added are the result of joining tasks with the same name/type or it's a task that has not been added yet, 
case that can be verified by checking that _id doesn't exist.
Tasks that can't be joined won't be saved to be delete, will just be ignored but if it's a new task, it will be saved as 
task to be added. */
function joinAllTasks(tasks) {
  let types = {} // map of task types (names) to their respective parameters. all parameters including old and new tasks.
  let taskIdsForType = {} // map of task types to tasks ids of the same type, including old and new tasks.
  let createNewTaskForType = {} // a set of task types that need to be added, or re-added, to genie.
  for (let i = 0; i < tasks.length; i++) {
    let name = tasks[i].name // task type is defined by its "name".
    let parameterId = taskParameterIdFromType[name] // the name of the attribute that goes along with this task name/type.
    // each task type has its parameters under an attribute with different name.

    // if parameters can't be joined and task isn't new.
    if (tasks[i][parameterId].constructor !== Array && tasks[i]._id !== undefined) continue // move to next task.

    if (!types[name]) { // if we haven't seen this task type before. this is the first of its type.
      types[name] = tasks[i][parameterId] // save this task's type and all its parameters.
      if (tasks[i]._id) { // testing id existence. old tasks already have an id.
        // save this task's type and its id, because we may need to delete it if it needs to be joined.
        taskIdsForType[name] = [tasks[i]._id] 
      } else { // if a task is new, it doesn't have an id yet, because it has never been added to genie.
        createNewTaskForType[name] = true // a new task certainly needs to be added to genie.
      }
      continue // first task of its type means nothing to join. move to next task.
    }

    // this part is reached if current task is not the first one found for its type.
    if (tasks[i]._id !== undefined) // for any task except the last one.
      taskIdsForType[name].push(tasks[i]._id) // remembering current task id because it will be joined.
    createNewTaskForType[name] = true // joined tasks always result in creating a new task.

    for (let j = 0; j < tasks[i][parameterId].length; j++) { // for each parameter of this task.
      let parameter = tasks[i][parameterId][j]

      let foundAtIndex = -1 // index at previous task. initializing with a value that means not found.
      if (parameter.constructor === Array) { // if a single parameter is also an array, that contains an Id and a value.
        for (let k = 0; k < types[name].length; k++) // search for parameter existence "manually".
          if (types[name][k][0] === parameter[0]) // first value is the identifier.
            foundAtIndex = k
      } else { // if parameter is not a group of values. (probably a single string).
        foundAtIndex = types[name].indexOf(parameter) // use javascript built in array search.
      }

      if (foundAtIndex < 0) // if parameter doesn't exist.
        types[name].push(parameter) // add it.
      else // if it already exists in a previous task.
        types[name][foundAtIndex] = parameter // substitute if with current value.
    }
  }

  tasksToDelete = {} // map of task types to ids of tasks that have the same type.
  tasksToAdd = [] // array of new tasks, joined tasks or completely new.
  for (let name in createNewTaskForType) { // for each task type to be created, or recreated.
    let ids = taskIdsForType[name] // getting ids that have the same type.
    if (ids && ids.length > 0) // if there is at least one id.
      tasksToDelete[name] = taskIdsForType[name] // save to list of tasks to delete.
    let newTask = {name: name} // create a new task of current type.
    newTask[taskParameterIdFromType[name]] = types[name] // add the joined parameters for current task type.
    tasksToAdd.push(newTask) // save to list of tasks to be added.
  }
  return [tasksToAdd, tasksToDelete]
}

/* for each taskid, send a request to GenieACS to delete that task. GenieACS doesn't have a call to delete more than one 
task at once. 'deviceid' is used to print error messages. */
async function deleteOldTaks (tasksToDelete, deviceid) {
  let promises = [] // array that will hold http request promises.
  for (let name in tasksToDelete) // for each task name/type.
    for (let i = 0; i < tasksToDelete[name].length; i++) // for each task._id in this task type/name.
      promises.push(deleteTask(tasksToDelete[name][i])) // add a request to array of promises.
  let results = await Promise.allSettled(promises) // wait for all promises to finish.
  for (let i = 0; i < results.length; i++) { // for each request result.
    if (results[i].reason) // if there was a reason it was rejected. print error message.
      console.log(`${results[i].reason.code} when deleting older tasks in genieacs rest api, for device ${deviceid}.`)
    else if (results[i].value.data === 'Task not found') // if it resolved to GenieACS saying task wasn't found.
      console.log(`Task not foud When deleting an old task in genieAcs rest api, for device ${deviceid}.`)
    // successful deletes don't need to be noted. they are expected to be successful.
  }
}

/* for each task send a request to GenieACS to add a task to a device id. GenieACS doesn't have a call to add more than one 
task at once. Returns an array in which the first position is an error message if there were any or null otherwise and the 
second position is an array of tasks there were not processed in less than 'timeout' millisecond. 'shouldRequestConnection' 
is a boolean that tells GenieACS to initiate a connection to the CPE/ONU and execute the task. If 'shouldRequestConnection' 
is given false, all tasks will be scheduled for later execution by Genie. */
async function sendTasks (deviceid, tasks, timeout, shouldRequestConnection) {
  let promises = [] // array that will hold http request promises.
  for (let i = 0; i < tasks.length; i++) // for each task.
    promises.push(postTask(deviceid, tasks[i], timeout, shouldRequestConnection)) // add a request to array of promises.
  let results = await Promise.allSettled(promises) // wait for all promises to finish.
  let errormsg // string variable that will hold all error messages.
  let pendingTasks = [] // array of tasks that did not execute in less than 'timeout' millisecond.
  for (let i = 0; i < results.length; i++) { // for each request result.
    if (results[i].reason) { // if there was a reason it was rejected. print error message.
      if (tasks[i].name === tasks[results.length-1].name) // if this task is brand new. last task has no _id field.
        errormsg += results[i].reason.code
          + ` when adding new task in genieacs rest api, for device ${devicei}.`
      else // if it's not the brand new task.
        errormsg += results[i].reason.code
          + ` when adding a joined task, in substitution of older tasks, in genieacs rest api, for device ${deviceid}.`
    } else if (i === results.length-1) { // if request wasn't rejected and it is the last task in the array of tasks.
      let response = results[i].value // referencing only promise's value.
      console.log(`response ${i})`, response.statusCode, response.statusMessage) // for debugging.
      if (response.statusMessage === 'No such device') { // if Genie responded saying device doesn't exist.
        errormsg += `Device ${deviceid} doesn't exist.`
      } else if (response.statusMessage === 'Device is offline') { // if Genie responded saying device is off-line.
        // user probably already knows when device is off line.
        sio.anlixSendGenieAcsTaskNotifications(deviceid, 
          {finished: false, taskid: JSON.parse(response.data)._id, source: 'request', message: response.statusMessage})
        console.log({deviceid, finished: false, taskid: JSON.parse(response.data)._id, source: 'request', 
          message: response.statusMessage})
      } else if (response.statusCode !== 200) { // if Genie didn't respond with code 200, it scheduled the task for latter.
        pendingTasks.push(JSON.parse(response.data)) // parse task to javascript object and add it to array of pending tasks.
      } else { // case where Genie responded with status code 200, this means task has execute before 'timeout'. 
        sio.anlixSendGenieAcsTaskNotifications(deviceid, 
          {finished: true, taskid: JSON.parse(response.data)._id, source: 'request', message: 'task executed.'})
        console.log({deviceid, finished: true, taskid: JSON.parse(response.data)._id, source: 'request', 
          message: 'task executed.'})
      }
    }
  }
  return [errormsg, pendingTasks]
}

/* given an array of tasks scheduled for later and an array of times to wait for these tasks to be executed, starts a 
mongodb change stream watching for delete events on GenieACS task collection waiting for a document which _id matches the 
last task _id and starts a timeout using the first number on given 'watchTimes'. If the change stream is executed first, the 
timeout is cleared/closed, the change stream is closed and a socket.io message is emitted saying the pending task has been 
executed. But if the timeout is executed first, the change stream is closed and if there are more values in 'watchTimes', 
the last task is used in a new call to addTask(...) with 'watchTimes' having the first value removed, meaning the whole 
process of adding a task will be done again (basically a retry of the last task), but if 'watchTimes' has no more values, 
emits a message saying task was not executed.*/
async function watchPendingTaskAndRetry (pendingTasks, deviceid, watchTimes) {
  let task = pendingTasks.pop() // removed last task out of the array.
  let watchTime = watchTimes.shift() // removed first value out of the array.
  let changeStream = tasksCollection.watch([ // starts a change stream in task collection from GenieACS database.
    {$match: {operationType: "delete", 'documentKey._id': mongodb.ObjectID(task._id)}} // listening for 'delete' events,
  ]) // filtered by document._id match.
  let taskTimer = setTimeout(async function () { // starts a timeout
    // if there are zero documents matching task._id. it measn task was executed and change stream probably saw it first.
    if (await tasksCollection.countDocuments({_id: mongodb.ObjectID(taskid._id)}) === 0) { return }

    // let dumTask = {name: getParameterValues, 
    //   parameterNames: ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.TotalBytesSent"]}
    // let [errormsg, pendingTasks] = await sendTasks(deviceid, [task], 5000, true, watchTimes)
    // if (pendingTasks.length === 0) { return }
    // taskTimer = setTimeout(async function () {
    //   if (await tasksCollection.countDocuments({_id: mongodb.ObjectID(task._id)}) === 0) { return }
    //   sio.anlixSendGenieAcsTaskNotifications(deviceid, 
    //     {finished: true, taskid: task._id, source: 'dumb task timer', 
    //     message: `task never executed in ${(watchTime/1000 +120).toFixed(0)} seconds.`})
    //   console.log({deviceid, finished: false, taskid: task._id, source: 'dumb task timer', 
    //     message: `task never executed in ${(watchTime/1000 +120).toFixed(0)} seconds.`})
    // }, 120000)

    // if there is a document still in database matching task._id.
    console.log('-- run out of time. retrying.') // for debugging.
    changeStream.close() // close change stream.
    if (watchTimes.length > 0) { // if there are more watchTimes in array.
      addTask(deviceid, task, 5000, true, watchTimes) // repeat the whole process of adding a task with one less watch time.
      /* we don't need to repeat the whole process using all tasks because when GenieACS execute one task, all tasks are 
      also executed. We actually only implement a retry because genie fails in its attempt to retry tasks. This is a 
      Genie hiccup. The result of our retry is the last task will be joined with itself and will be removed and re added.*/ 
    } else { // if there no more watch times we won't retry anymore.
      // sending a socket.io message saying it wasn't executed.
      sio.anlixSendGenieAcsTaskNotifications(deviceid, 
        {finished: false, taskid: JSON.parse(response.data)._id, source: 'timer', 
        message: `task never executed for deviceid ${deviceid}`})
      console.log({deviceid, finished: false, taskid: JSON.parse(response.data)._id, source: 'timer', 
        message: `task never executed for deviceid ${deviceid}`})
    }
  }, watchTime) // amount of time to wait before executing setTimeout.

  // waiting for only one match on the change stream. simply because we filter by _id, which is unique.
  // if the last task was execute, it's high likely the previous tasks were also executed.
  if (await changeStream.hasNext()) {
    let change = await changeStream.next()
    changeStream.close() // close this change stream.
    clearTimeout(taskTimer) // clear setTimeout
    // sending a socket.io message saying it was executed.
    sio.anlixSendGenieAcsTaskNotifications(deviceid, 
      {finished: true, taskid: task._id, source: 'change stream', message: 'task executed.'})
    console.log({deviceid, finished: true, taskid: task._id, source: 'change stream', 
      message: `task executed for deviceid ${deviceid}`})
  }
}

/* Get all tasks, in GenieACS, for a device, remove unnecessary tasks, join tasks that could have been issue together and 
add a new given task for a given device id and returns an array in which the first position is an error message, when there 
is any, or null where there is none, and in the second position, a true value if the new task is executed under 'timeout' or 
null if it will emit the result through socket.io. Possible returns:
- [msg !== null, null]: error.
- [msg === null, null]: result will be given using socket.io.
- [msg === null, true]: task executed successfully before 'timeout' run out.

Arguments:
'deviceid' is a string identifying a device in GenieACS database. 
'task' is an object which structure is a Genie task with its parameters already set. refer to 
https://github.com/genieacs/genieacs/wiki/API-Reference#tasks.
'timeout' is a number in milliseconds that will be used as request timeout when communicating with GenieACS. 
'shouldRequestConnection' is a boolean that tells GenieACS to initiate a connection to the CPE/ONU and execute the task. 
'watchTimes' is an array of numbers that are the milliseconds used for waiting for scheduled tasks to disappear from 
GenieACS database, used only if the request 'timeout', sent to genie, runs out without an answer confirm the task execution.
Having 2 or more numbers in this array means one or more retries to genie, for the cases when genie can't retry a task 
on its own. After all retries sent to genie, if the retried task doesn't disappear from its database, a message saying the 
task has not executed is emitted through socket.io.*/
genie.addTask = async function (deviceid, task, timeout=5000, shouldRequestConnection, watchTimes=[600000, 120000]) {
  console.log("-- starting to send task.") // for debugging.

  if (!checkTask(task)) return ['task not valid.', null] // checking task format and data types.

  console.log("-- getting older tasks.")
  // getting older tasks for this deviceid.
  let query = {device: deviceid} // selecting all tasks for a given deviceid.
  let response = await request({ method: 'GET', hostname: GENIEHOST, port: GENIEPORT, 
    path: '/tasks/?query='+encodeURIComponent(JSON.stringify(query)) // coding json in url allowed characters.
  }).catch(e => e) // return value will be error object in case of connection errors.
  if (response.constructor === Error) { // in case of connections errors, return error code in error message.
    return [`${response.code} when getting old tasks from genieacs rest api, for device ${deviceid}.`, null]
  } // if no errors, move on.

  console.log("-- parsing older tasks.") // for debugging.
  let tasks = JSON.parse(response.data) // parsing older tasks. they are always object inside an array.
  tasks.push(task) // adding the new task as one more older task to tasks array.

  if (tasks.length > 1) { // if there was at least one task plus the current task being added in tasks array.
    console.log("-- joining tasks tasks.") // for debugging.
    let tasksToDelete // declaring variable that will hold array of tasks to be delete/substituted.
    [tasks, tasksToDelete] = joinAllTasks(tasks) // substitutes tasks array with arrays of tasks to be added to genie.

    /* we have to delete old tasks before adding the joined tasks because it could happen that an old task is executed while 
    we add their joined counterpart, in which case deleting it would give make genie return task not found. So we delete old 
    tasks as fast as we can. Adding a task makes us wait at least a 'timeout' amount of milliseconds, so it isn't fast. */
    if (Object.keys(tasksToDelete).length > 0) {// if there are tasks being substituted by new ones, 
      console.log("-- deleting tasks tasks.") // for debugging.
      await deleteOldTaks(tasksToDelete) // there will be tasks to be deleted.
    }
  }
  
  console.log("-- sending tasks.") // for debugging.
  // send the new task and the old tasks being substituted.
  let [errormsg, pendingTasks] = await sendTasks(deviceid, tasks, timeout, shouldRequestConnection)
  if (errormsg) return [errormsg, null]

  if (pendingTasks.length > 0) { // if genie didn't execute the task before the timeout.
    console.log("-- watching pending tasks.") // for debugging.
    watchPendingTaskAndRetry(pendingTasks, deviceid, watchTimes) // watch tasks collection for the new task to be deleted.
    // not awaiting this function call because it will emit its result using socket.io (web sockets).
    return [null, null] // returning no error and no true value because result is still being produced.
  }

  return [null, true] // returning true because task has been executed before 'timeout' finished.
}

module.exports = genie;