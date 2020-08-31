/*
Set of functions that will handle the communication from flashman to genieacs 
through the use of genieacs-nbi, the genie rest api.
*/

const http = require('http');


const request = (options, body) => {
  options.path = encodeURIComponent(options.path)
  return new Promise((resolve, reject) => {
    let req = http.request(options, res => {
      res.setEncoding('utf8')
      let data = ''
      res.on('data', chunk => data+=chunk)
      res.on('end', _ => {resolve(data)})
    })
    req.on('error', e => {reject(e)})
    if (body !== undefined && body.constructor === String) req.write(body)
    req.end()
  })
}

let GENIEHOST = 'localhost'
let GENIEPORT = 7557

let taskParameterIdFromType = {
  getParameterValues: "parameterNames",
  setParameterValues: "parameterValues",
  refreshObject: "objectName",
  addObject: "objectName",
  download: "file",
}

function checkTask (task) {
  let name = task.name
  let parameterId = taskParameterIdFromType[name]
  if (parameterId === undefined) return false
  if (name === "setParameterValues") {
    if (task[parameterId].constructor !== Array) return false
    for (let i = 0; i < task[parameterId].length; i++) {
      if (task[parameterId][i].constructor !== Array) return false
      if (task[parameterId][i].length !== 2) return false
      if (task[parameterId][i][0].constructor !== String || task[parameterId][i][1].constructor !== String) return false
    }
  } else if (name === "getParameterValues" ) {
    if (task[parameterId].constructor !== Array) return false
    for (let i = 0; i < task[parameterId].length; i++) {
      if (task[parameterId][i].constructor !== String) return false
    }
  } else {
    if (task[parameterId].constructor !== String) return false
  }
  return true
}

function joinAllTasks(tasks) {
  let types = {}
  let createNewTaskForType = {}
  let taskIdsForType = {}
  for (let i = 0; i < tasks.length; i++) {
    let name = tasks[i].name // task type is defined by its "name".
    let parameterId = taskParameterIdFromType[name] // each task type has its parameters under an attribute with different name.

    if (tasks[i][parameterId].constructor !== Array) // if parameters can't be joined.
      continue // move to next task.

    if (!types[name]) { // there may be, or may not be, more tasks of this type.
      types[name] = tasks[i][parameterId]
      taskIdsForType[name] = [tasks[i]._id]
      if (tasks[i]._id === undefined) // if the new task is of type that didn't exist before.
        createNewTaskForType[name] = true
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
  // console.log(types)
  // console.log(taskIdsForType)
  // console.log(createNewTaskForType)

  // tasksToDelete = []
  // tasksToAdd = []
  // for (let name in createNewTaskForType) {
  //   for (let i = 0; i < taskIdsForType[name].length; i++)
  //     tasksToDelete.push(taskIdsForType[name][i])
  //   newTask = {name: name}
  //   newTask[taskParameterIdFromType[name]] = types[name]
  //   tasksToAdd.push(newTask)
  // }
  tasksToDelete = {}
  tasksToAdd = []
  for (let name in createNewTaskForType) {
    tasksToDelete[name] = taskIdsForType[name]
    newTask = {name: name}
    newTask[taskParameterIdFromType[name]] = types[name]
    tasksToAdd.push(newTask)
  }
  return [tasksToAdd, tasksToDelete]
}

function postTask (deviceid, task, timeout, shouldRequestConnection) {
  return request({ method: "POST", hostname: GENIEHOST, port: GENIEPORT,
    path: '/devices/'+deviceid+'/tasks?timeout='+10000+(true ? '&connection_request' : '')
  }, JSON.stringify(task))
}

function deleteTask (taskid) {
  return request({ method: 'DELETE', hostname: GENIEHOST, port: GENIEPORT, path: '/tasks/'+taskid })
}


// refer to https://github.com/genieacs/genieacs/wiki/API-Reference#tasks
// 'deviceid' is a string. 'taskobj' is an object which structure is the given 
// task with its parameters already set. 'timeout' is a number in 
// milliseconds. 'shouldRequestConnection' is a boolean that tells GenieACS to 
// initiate a connection to the CPE.
const addTask = async function (deviceid, task, timeout, shouldRequestConnection) {
  if (!checkTask(task)) return false

  // getting older tasks for this deviceid.
  let query = {device: deviceid}
  let dataString = await request({ method: 'GET', hostname: GENIEHOST, port: GENIEPORT, 
    path: '/tasks/?query='+encodeURIComponent(JSON.stringify(query))
  })
  .catch(e => '[]')

  var tasks = JSON.parse(dataString)
  tasks.push(task)

  let tasksToDelete = []
  if (tasks.length > 1) // if there was at least one task, plus the current task being added.
    [tasks, tasksToDelete] = joinAllTasks(tasks)
  // console.log(tasks)
  // console.log(tasksToDelete)

  // let promises = []
  // for (var i = 0; i < tasks.length; i++)
  //   promises.push(postTask(deviceid, tasks[i], timeout, shouldRequestConnection))
  // let results = await Promises.allSettled(promises)
  // for (let i = 0; i < results.length; i++) {
  //   if (results[i].reason)
  // }
  // if (tasksToDelete.length > 0) {
  //   promises = []
  //   for (var i = 0; i < tasksToDelete.length; i++)
  //     promises.push(deleteTask(tasksToDelete[i]))
  //   results = await Promises.allSettled(promises)
  // }
  
  let promises = []
  for (var i = 0; i < tasks.length; i++)
    promises.push(postTask(deviceid, tasks[i], timeout, shouldRequestConnection))
  let results = await Promises.allSettled(promises)
  let shouldAbort = false
  for (let i = 0; i < results.length; i++) {
    if (results[i].reason) {
      if (tasksToDelete !== undefined) delete tasksToDelete[tasks[i].name]
      if (tasks[i].name === task.name) {
        console.log('Error when adding new task in genieacs rest api for device '+deviceid)
        shouldAbort = true
      } else {
        console.log('Error when adding a joined task in genieacs rest api in substitution of older tasks.')
      }
    }
  }
  if (Object.keys(tasksToDelete).length > 0) {
    promises = []
    for (let name in tasksToDelete)
      for (var i = 0; i < tasksToDelete.length; i++)
        promises.push(deleteTask(tasksToDelete[name][i]))
    await Promises.allSettled(promises)
  }

  if (shouldAbort)
    return false
  return true

}