const fs = require('fs');
const functions = require('firebase-functions');
const uuidv1 = require('uuid/v1');
const admin = require('firebase-admin');
const path = require('path');
const cors = require('cors')({origin: true});
const vision = require('@google-cloud/vision');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);


// Makes an ffmpeg command return a promise.
function promisifyCommand(command) {
  return new Promise((resolve, reject) => {
    command.on('end', resolve).on('error', reject).run();
  });
}

admin.initializeApp();
const projectId = admin.instanceId().app.options.projectId;
const bucketName = `${projectId}.appspot.com`;
const visionClient = new vision.v1p3beta1.ImageAnnotatorClient();

exports.saveAudioSuggestions = functions.https.onRequest(async (req, res) => {
  return cors(req, res, async () => {
    const hasAccess = await checkAccess_(req, res);
    if (!hasAccess) {
      return;
    }
    const fileName = uuidv1();
    const filePath = `suggestions/${fileName}.mp3`
    const options = {
      destination: filePath,
      metadata: {
        contentType: 'audio/mp3',
      }
    };
    const bucket = admin.storage().bucket(bucketName);
    try {
      // Convert base64 body to blob of webm.
      const nodeBuffer = Buffer.from(req.body, 'base64');
      var tempLocalPath = `/tmp/${fileName}.webm`;
      const targetTempFilePath =  `/tmp/${fileName}.mp3`;
      fs.writeFileSync(tempLocalPath, nodeBuffer);
      var command = new ffmpeg(tempLocalPath)
        .toFormat('mp3')
        .save(targetTempFilePath); 
      await promisifyCommand(command);
      await bucket.upload(targetTempFilePath, options);
      console.log(`Audio saved successfully.`);
      fs.unlinkSync(tempLocalPath);
      fs.unlinkSync(targetTempFilePath);
      // Make the file publicly accessible.
      var file = bucket.file(filePath);
      file.makePublic();
      // Rather than getting the bucket URL, get the public HTTP URL.
      const metadata = await file.getMetadata();
      const mediaLink = metadata[0].mediaLink;
      console.log(`Audio available publicly at ${mediaLink}.`);
      res.status(200).send(mediaLink);
    } catch (err) {
      console.log(`Unable to upload audio ${err}`)
    }
  });
});

exports.initSettings = functions.https.onRequest(async (req, res) => {
  return cors(req, res, async () => {
    console.log("Initializing settings");
    try {
      const querySnapshot = await admin.firestore().collection("app_settings").doc("default").create({
        privacy_policy: "",
        logo_image_id: "",
        app_enabled: true,
        app_name: "",
        app_url: "",
        translation_language: "",
        primary_language: "",
      });
      res.status(200).send(JSON.stringify("Settings initialized."));
      console.log("Settings initialized.");
    } catch (err) {
      console.log("Error initializing settings:", err);
      res.status(404).send("Error initializing settings");
    }
  });
});

exports.updateSettings = functions.https.onRequest(async (req, res) => {
  return cors(req, res, async () => {
    console.log("Updating settings");
    try {
      const querySnapshot = await admin.firestore().collection("app_settings").get();
      // There should be 1 and only 1 document in the collection
      if (querySnapshot.empty || querySnapshot.docs[0].empty) { // collection or document empty
        console.log("Settings not found");
        res.status(404).send("NO settings");
        return "404";
      }
      if (querySnapshot.docs.length != 1) {
        console.log("Too many documents in collection");
        res.status(404).send("Error updating settings");
        return "404";
      }
      var docs = querySnapshot.docs.map(doc => doc.data());

      const privacy_policy = req.body.privacy_policy || docs[0]["privacy_policy"];
      const logo_image_id = req.body.logo_image_id || docs[0]["logo_image_id"];
      const app_enabled = req.body.app_enabled || docs[0]["app_enabled"];

      const doc_ids = querySnapshot.docs.map (doc => doc.id);

      const snapshot = await admin.firestore().collection("app_settings").doc(doc_ids[0]).set({
          privacy_policy: privacy_policy,
          logo_image_id: logo_image_id,
          app_enabled: app_enabled
        },
        {merge: true}
      );
      res.status(200).send(JSON.stringify("Settings updated."));
      console.log("Settings updated");
    } catch(err) {
      console.log("Error updating settings:", err);
      res.status(404).send("Error updating settings");
    }
  });
});

exports.readSettings = functions.https.onRequest(async (req, res) => {
  return cors(req, res, async () => {
    console.log("Reading settings");
    try {
      const querySnapshot = await admin.firestore().collection("app_settings").get();
      // There should be 1 and only 1 document in the collection
      if (querySnapshot.empty || querySnapshot.docs[0].empty) { // collection or document empty
        console.log("Settings not found");
        res.status(404).send("NO settings");
        return "404";
      }
      if (querySnapshot.docs.length != 1) {
        console.log("Too many documents in collection");
        res.status(404).send("Error updating settings");
        return "404";
      }
      var docs = querySnapshot.docs.map(doc => doc.data());
      const settings_json = JSON.stringify({data: docs});
      res.status(200).send(settings_json);
      console.log("Finished reading settings");
    } catch(err) {
      console.log("Error reading settings:", err);
      res.status(404).send("Error reading settings");
    }
  });
});

exports.addSuggestions = functions.https.onRequest(async (req, res) => {
  return cors(req, res, async () => {
    const hasAccess = await checkAccess_(req, res);
    if (!hasAccess) {
      return;
    }
    var snapshot = await admin.firestore().collection('suggestions').add({
      english_word: req.body.english_word,
      translation: req.body.translation,
      transliteration: req.body.transliteration,
      sound_link: req.body.sound_link,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log('Translation suggestions saved.');
    res.status(200).send("Translation suggestions saved.");
  });
});

exports.addTranslations = functions.https.onRequest(async (req, res) => {
  return cors(req, res, async () => {
    var snapshot = await admin.firestore().collection('translations').doc(req.body.english_word).set({
      english_word: req.body.english_word,
      translation: req.body.translation,
      transliteration: req.body.transliteration,
      sound_link: req.body.sound_link,
      frequency: +req.body.frequency || -1,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log('Translation saved.');
    res.status(200).send("Translation saved.");
  });
});


exports.getTranslation = functions.https.onRequest(async (req, res) => {
  const hasAccess = await checkAccess_(req, res);
  if (!hasAccess) {
    return;
  }
  var docRef = admin.firestore().collection("translations").doc(req.body);
  try {
    const doc = await docRef.get();
    if (doc.exists) {
        console.log("Document data:", doc.data());
        res.status(200).send(doc.data());
        return doc.data()
    } else {
        console.log("No such document!");
        res.status(404).send("404");
        return "404"
    }
  } catch(err) {
    console.log("Error getting document:", err);
  }
});

// For App, which will be used by app users
// https://us-central1-barnard-project.cloudfunctions.net/getTranslations
exports.getTranslations = functions.https.onRequest(async (req, res) => {
  const hasAccess = await checkAccess_(req, res);
  if (!hasAccess) {
    return;
  }
  const english_words = req.body.english_words || [];
  console.log(english_words);
  const collectionRef = admin.firestore().collection("translations");
  const createResponse = (res) => {
    var data = {
        english_word: (res === undefined) ? '' : res.english_word ,
        translation: (res === undefined) ? '' : res.translation ,
        transliteration: (res === undefined) ? '' : res.transliteration,
        sound_link: (res === undefined) ? '' : res.sound_link
    }
    return data;
  }
  const promises = english_words.map(async english_word => {
    return collectionRef.doc(english_word).get()
  })
  Promise.all(promises).then(docs => {
    var translations = docs.map(x => createResponse(x.data()))
    console.log(translations);
    res.set('Access-Control-Allow-Origin', "*");
    res.set('Access-Control-Allow-Methods', 'GET, POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.status(200).send(translations);
    return "200"
  }).catch(function(error) {
      console.log("Internal server error", error);
      res.status(500).send(error)
  });
});

// For translation page, which will be used by admin & moderators.
// https://us-central1-barnard-project.cloudfunctions.net/translations?limit=2&reverse=true&first500=true
exports.translations = functions.https.onRequest(async (req, res) => {
  const hasAccess = await checkAccess_(req, res);
  if (!hasAccess) {
    return;
  }
  const start = +req.query.start || 1;
  const limit = +req.query.limit || 20;
  const reverse = Boolean(req.query.reverse) || false;
  const first500 = Boolean(req.query.first500) || false;
  //const array_contains = req.query.array_contains || "";
  var reverse_order = (reverse) ? "asc" : "desc";
  var docRef = admin.firestore().collection("translations")
    .orderBy("frequency", reverse_order).limit(limit);

  let querySnapshot;

  if (first500) {
    querySnapshot = await docRef.where('frequency', '>', 10).get();
  } else {
    querySnapshot = await docRef.get();
  }

  docRef.get().then(querySnapshot => { 
    if (querySnapshot.empty) {
        res.status(404).send("NO translations");
    } else {
        var docs = querySnapshot.docs.map(doc => doc.data())
        var translations_json = JSON.stringify({data: docs})
        res.status(200).send(translations_json)
    }
  }).catch(function(error) {
      console.log("Error getting document:", error)
      res.status(500).send(error)
  });
});

<<<<<<< HEAD
=======

// todo(parikhshiv) - made this method mainly for development, can be
// replaced / expanded
>>>>>>> 85c63cd... solve confilict
exports.getEntireCollection = functions.https.onRequest(async (req, res) => {
  const pageSize = +req.query.pageSize;
  const pageNum = +req.query.pageNum;
  const state = req.query.state;
  const needsRecording = req.query.needsRecording;
  const search = req.query.search;
  return cors(req, res, async () => {
    const hasAccess = await checkAccess_(req, res);
    if (!hasAccess) {
      return;
    }
    let collection = admin.firestore().collection(req.query.collectionName)
      .orderBy("english_word");

    try {
      const collectionDocs = await collection.get();
      if (collectionDocs.docs.length) {
          let filteredCollection = collectionDocs.docs.map((doc) => {
            return {...doc.data(), id: doc.id};
          });

          if (state === 'incomplete') {
            filteredCollection = filteredCollection.filter((doc) => {
              return !doc.translation;
            });
          } else if (state === 'complete') {
            filteredCollection = filteredCollection.filter((doc) => {
              return doc.translation;
            });
          }

          if (needsRecording && needsRecording !== '0') {
            filteredCollection = filteredCollection.filter((doc) => {
              return !doc.sound_link;
            });
          }

          if (search) {
            filteredCollection = filteredCollection.filter((doc) => {
              return doc.english_word.startsWith(search);
            });
          }

          if (pageNum && pageSize) {
            const startIdx = (pageNum - 1)*pageSize;
            const endIdx = startIdx + pageSize;
            res.status(200).send(filteredCollection.slice(startIdx, endIdx));
          } else {
            res.status(200).send(filteredCollection);
          }
          return filteredCollection;
      } else {
          console.log("No such collection");
          res.status(200).send(collectionDocs.docs);
          return collectionDocs.docs;
      }
    } catch(err) {
      console.log("Error getting translations:", err);
    }
  });
});


exports.addFeedback = functions.https.onRequest(async (req, res) => {
  return cors(req, res, async () => {
    var snapshot = await admin.firestore().collection('feedback').add({
      english_word: req.body.english_word,
      translation: req.body.translation,
      transliteration: req.body.transliteration,
      types: req.body.types,
      content: req.body.content,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.status(200).send("feedback saved.");
  });
});


exports.deleteRow = functions.https.onRequest(async (req, res) => {
  return cors(req, res, async () => {
    const hasAccess = await checkAccess_(req, res);
    if (!hasAccess) {
      return;
    }
    const doc = admin.firestore().collection(req.body.collectionName)
      .doc(req.body.id);
    try {
      await doc.delete();
      console.log("successful deletion!");
      res.status(200).send(JSON.stringify("Row deleted."));
    } catch(err) {
      console.log("Error getting translations:", err);
    }
  });
});


// Auth functions
exports.grantModeratorRole = functions.https.onRequest((req, res) => {
  return cors(req, res, async () => {
    try {
      const hasAccess = await checkAdminAccess_(req, res);
      if (!hasAccess) {
        return;
      }
      const revoke = Boolean(req.body.revoke);
      const user = await admin.auth().getUserByEmail(req.body.email);

      if (!user) {
        res.status(404);
        return;
      }

      console.log(revoke);
      if (revoke) {
        if (!(user.customClaims && user.customClaims.moderator)) {
          res.status(200).send(JSON.stringify("Already not a moderator."));
          return;
        }
      } else {
        if (user.customClaims && user.customClaims.moderator) {
          res.status(200).send(JSON.stringify("Already a moderator."));
          return;
        }
      }

      admin.auth().setCustomUserClaims(user.uid, {
          moderator: !revoke,
      });
      res.status(200).send(JSON.stringify("Success"));
    } catch(err) {
      res.status(500).send(err);
      console.log("Error", err);

exports.visionAPI = functions.https.onRequest(async (req, res) => {
  return cors(req, res, async () => {
    try {
      console.log("hi")
      const requestVision = {
        image: {content: Buffer.from(req.body, 'base64')},
        features: [{type: 'LABEL_DETECTION'}, {type: 'SAFE_SEARCH_DETECTION'}]
      };
      visionClient.annotateImage(requestVision)
        .then(response => {
          const labels = response[0].labelAnnotations;
          var objects = labels.map(label => label.description);
          res.status(200).send(objects);
          return "200"
        })
        .catch(err => {
          console.error(err);
        });
    } catch (err) {
      console.log(`Unable to detect objects: ${err}`)
    }
  });
});


exports.grantAdminRole = functions.https.onRequest((req, res) => {
  return cors(req, res, async () => {
    try {
      const hasAccess = await checkAdminAccess_(req, res);
      if (!hasAccess) {
        return;
      }
      const revoke = Boolean(req.body.revoke);
      const user = await admin.auth().getUserByEmail(req.body.email); // 1

      if (!user) {
        res.status(404);
        return;
      }

      if (revoke) {
        if (!(user.customClaims && user.customClaims.admin)) {
          res.status(200).send(JSON.stringify("Already not an admin."));
          return;
        }
      } else {
        if (user.customClaims && user.customClaims.admin) {
          res.status(200).send(JSON.stringify("Already an admin."));
          return;
        }
      }

      admin.auth().setCustomUserClaims(user.uid, {
          admin: !revoke,
      });
      res.status(200).send(JSON.stringify("Success"));
    } catch(err) {
      res.status(500).send(err);
      console.log("Error", err);
    }
  });
});

// Auth Methods

exports.onUserCreated = functions.auth.user().onCreate(async (user) => {
  await setFirstUserAsAdmin();
});

async function setFirstUserAsAdmin() {
  try {
    const listUsersResult = await admin.auth().listUsers();
    let anyAdmins = listUsersResult.users.some((user) => {
      return user.customClaims && user.customClaims.admin;
    });

    if (!anyAdmins && listUsersResult.users.length < 10) {
      // For new apps (smaller number of users), make every existing user
      // an admin if none exist yet.
      listUsersResult.users.forEach((user) => {
        admin.auth().setCustomUserClaims(user.uid, {
          admin: true,
        });
      });
    }
  } catch(err) {
    console.log('error', err);
  }
}

async function checkAccess_(req, res) {
  try {
    const customClaims = await getCustomClaims_(req, res);
    if (!customClaims) {
      res.status(403).send(JSON.stringify("Permission Denied."));
      return false;
    }

    if (!(customClaims.moderator || customClaims.admin)) {
      res.status(403).send(JSON.stringify("Permission Denied."));
      return false;
    }

    return true;
  } catch(err) {
    res.status(403).send(JSON.stringify("Permission Denied."));
    return false;
  }
}

async function checkAdminAccess_(req, res) {
  try {
    const customClaims = await getCustomClaims_(req, res);
    if (!customClaims) {
      res.status(403).send(JSON.stringify("Permission Denied."));
      return false;
    }

    if (!customClaims.admin) {
      res.status(403).send(JSON.stringify("Permission Denied."));
      return false;
    }

    return true;
  } catch(err) {
    res.status(403).send(JSON.stringify("Permission Denied."));
    return false;
  }
}

async function getCustomClaims_(req, res) {
  const authHeader = req.get('Authorization');
  if (!authHeader) {
    res.status(403).send(JSON.stringify("Permission Denied."));
    return false;
  }
  const tokenId = req.get('Authorization').split('Bearer ')[1];
  return await admin.auth().verifyIdToken(tokenId);
}


// For testing purposes only
exports.testEndpoint = functions.https.onRequest((req, res) => {
  return cors(req, res, () => {
    res.send({ 'a': 'hello from firebase'});
  });
});
