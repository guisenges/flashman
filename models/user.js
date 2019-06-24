
const mongoose = require('mongoose');
const bcrypt = require('bcrypt-nodejs');
const request = require('request');

const Config = require('./config');

let userSchema = new mongoose.Schema({
  name: {
    type: String,
    unique: true,
    required: true,
  },
  password: {
    type: String,
    unique: true,
    required: true,
  },
  lastLogin: {type: Date},
  createdAt: {type: Date, default: new Date()},
  autoUpdate: {type: Boolean, default: true},
  maxElementsPerPage: {type: Number, default: 10},
  is_superuser: {type: Boolean, default: false},
  role: {type: String, required: false},
});

// Execute before each user.save() call
userSchema.pre('save', function(callback) {
  let user = this;
  let changedAttrs = {};
  let requestOptions = {};
  const attrsList = user.modifiedPaths();

  // Verify if password has changed
  if (user.isModified('password')) {
    // Password changed so we need to hash it again
    bcrypt.genSalt(5, function(err, salt) {
      if (err) return callback(err);
      bcrypt.hash(user.password, salt, null, function(err, hash) {
        if (err) return callback(err);
        user.password = hash;
      });
    });
  }

  // Verify modified fields and trigger trap
  if (attrsList.length > 0) {
    // Send modified fields if callback exists
    Config.findOne({is_default: true}).lean().exec(function(err, defConfig) {
      if (err || !defConfig.traps_callbacks ||
                 !defConfig.traps_callbacks.user_crud) {
        return callback(err);
      }
      let callbackUrl = defConfig.traps_callbacks.user_crud.url;
      let callbackAuthUser = defConfig.traps_callbacks.user_crud.user;
      let callbackAuthSecret = defConfig.traps_callbacks.user_crud.secret;
      if (callbackUrl) {
        attrsList.forEach((attr) => {
          changedAttrs[attr] = user[attr];
        });
        requestOptions.url = callbackUrl;
        requestOptions.method = 'PUT';
        requestOptions.json = {
          'id': user._id,
          'name': user.name,
          'changes': changedAttrs,
        };
        if (callbackAuthUser && callbackAuthSecret) {
          requestOptions.auth = {
            user: callbackAuthUser,
            pass: callbackAuthSecret,
          };
        }
        request(requestOptions);
      }
    });
  }

  callback();
});

userSchema.post('remove', function(user, callback) {
  let requestOptions = {};

  // Send modified fields if callback exists
  Config.findOne({is_default: true}).lean().exec(function(err, defConfig) {
    if (err || !defConfig.traps_callbacks ||
               !defConfig.traps_callbacks.user_crud) {
      return callback(err);
    }
    let callbackUrl = defConfig.traps_callbacks.user_crud.url;
    let callbackAuthUser = defConfig.traps_callbacks.user_crud.user;
    let callbackAuthSecret = defConfig.traps_callbacks.user_crud.secret;
    if (callbackUrl) {
      requestOptions.url = callbackUrl;
      requestOptions.method = 'PUT';
      requestOptions.json = {
        'id': user._id,
        'name': user.name,
        'removed': true,
      };
      if (callbackAuthUser && callbackAuthSecret) {
        requestOptions.auth = {
          user: callbackAuthUser,
          pass: callbackAuthSecret,
        };
      }
      request(requestOptions);
    }
  });
  callback();
});

// Function that verifies if hashed password inside model is equal
// to another
userSchema.methods.verifyPassword = function(password, callback) {
  bcrypt.compare(password, this.password, function(err, isMatch) {
    if (err) return callback(err);
    callback(null, isMatch);
  });
};

let User = mongoose.model('User', userSchema);

module.exports = User;
