
const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate');

let Schema = mongoose.Schema;

let firmwareSchema = new Schema({
  vendor: {type: String, required: true},
  model: {type: String, required: true},
  version: {type: String, required: true},
  release: {type: String, required: true},
  filename: {type: String, required: true},
});

firmwareSchema.plugin(mongoosePaginate);

let Firmware = mongoose.model('Firmware', firmwareSchema);

module.exports = Firmware;
