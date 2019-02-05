import * as functions from 'firebase-functions';
import {Storage, SaveOptions, GetSignedUrlConfig} from '@google-cloud/storage';
import sharp = require('sharp');
import * as childProcessPromise from 'child-process-promise';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

import * as admin from 'firebase-admin';
import * as express from 'express';
import * as firebaseHelper from 'firebase-functions-helper';
import * as bodyParser from 'body-parser';
import * as stream from 'stream';
import * as mkdirp from 'mkdirp-promise';
import * as cors from 'cors';
import * as http from 'http';
import * as uuid from 'uuid/v4';
import * as dotenv from "dotenv";
import * as fileType from 'file-type';
import * as listingData from './import.json';


dotenv.config();

import * as algoliasearch from 'algoliasearch';
import {
  ClientOptions,
  SynonymOption,
  ApiKeyOptions,
  SearchSynonymOptions,
  SecuredApiOptions,
  Index,
  Response,
  IndexSettings,
  QueryParameters,
  Client
} from 'algoliasearch';

import async = require("async");
import { ErrorCallback, AsyncResultCallback, AsyncBooleanResultCallback, Dictionary } from "async";

const {Base64Encode} = require('base64-stream');

// Max height and width of the thumbnail in pixels.
const THUMB_MAX_HEIGHT = 300;
const THUMB_MAX_WIDTH = 300;
// Thumbnail prefix added to file names.
const THUMB_PREFIX = 'thumb_';
const spawn = childProcessPromise.spawn;

const storage = new Storage({
  projectId: functions.config().google ? functions.config().google.firebase_project_id : process.env.google_firebase_project_id,
  keyFilename: 'serviceAccountKey.json',
});







// const bucket = storage.bucket('konleng-firebase.appspot.com')

const serviceAccount = require('./serviceAccountKey.json');
const databaseURL = functions.config().google ? functions.config().google.firebase_database_url : process.env.google_firebase_database_url;
const appFirestore = firebaseHelper.firebase.initializeApp(serviceAccount, databaseURL);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: databaseURL,
  storageBucket: functions.config().google ? functions.config().google.storage_id : process.env.google_storage_id
});


const db = appFirestore.firestore;
db.settings({ timestampsInSnapshots: true });
const app = express();
const main = express();
const listingsCollection = "listings";
const usersCollection = "users";

// [START init_algolia]
// Initialize Algolia, requires installing Algolia dependencies:
// https://www.algolia.com/doc/api-client/javascript/getting-started/#install
//
// App ID and API Key are stored in functions config variables


const ALGOLIA_ID = functions.config().algolia ? functions.config().algolia.app_id : process.env.algolia_app_id;
const ALGOLIA_ADMIN_KEY = functions.config().algolia ? functions.config().algolia.api_key : process.env.algolia_api_key;
const ALGOLIA_SEARCH_KEY = functions.config().algolia ? functions.config().algolia.search_key : process.env.algolia_search_key;

const ALGOLIA_NEWEST_INDEX = 'listings';
const ALGOLIA_OLDEST_INDEX = 'listings_oldest';
const ALGOLIA_HIGHEST_INDEX = 'listings_highest';
const ALGOLIA_CHEAPEST_INDEX = 'listings_cheapest';
const client = algoliasearch(ALGOLIA_ID, ALGOLIA_ADMIN_KEY);
// [END init_algolia]




exports.onListingUpdated = functions.firestore.document('listings/{listingId}').onUpdate(async (snap, context) => {

  const listing = snap.after.data();

  listing.objectID = context.params.listingId;
  listing._geoloc = {
    lat: listing.lat,
    lng: listing.lng
  }

  console.log('LISTING ===> ', listing);

  const newestIndex = client.initIndex(ALGOLIA_NEWEST_INDEX);
  await newestIndex.saveObject(listing);


  return true;
});


exports.onListingDeleted = functions.firestore.document('listings/{listingId}').onDelete(async (snap, context) => {
  const listing = snap.data();
  listing.objectID = context.params.listingId;
 

      const newestIndex = client.initIndex(ALGOLIA_NEWEST_INDEX);
      await newestIndex.deleteObject(listing.objectID);


      return true;

    });


// [START get_firebase_user]
async function getFirebaseUser(req, res, next) {


  if (!req.headers.authorization || !req.headers.authorization.startsWith('Bearer ')) {

    return res.sendStatus(403);
  }

  let idToken;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {

    idToken = req.headers.authorization.split('Bearer ')[1];
  }

  try {
    const decodedIdToken = admin.auth().verifyIdToken(req.userToken).then((user) => {

      req.user = user;
      res.send(user);
    }, (error) => {
      console.error('Error User');
      res.send('Token invalid' + error);
    });
    
    // console.log('ID Token correctly decoded', decodedIdToken.uid);
    req.user = decodedIdToken;
    res.send(req.user);
    return next();
  } catch(error) {
    console.error('Error while verifying Firebase ID token:', error);
    return res.status(403).send('Unauthorized');
  }
}
// [END get_firebase_user]


function makeid() {
  let text = "";
  let possible = "abcdefghijklmnopqrstuvwxyz0123456789";

  for (var i = 0; i < 7; i++)
    text += possible.charAt(Math.floor(Math.random() * possible.length));

  return text;
}

async function generateToken(req, res, next){
  let uid = req.user.uid;

  admin.auth().createCustomToken(uid)
  .then((customToken) => {
    req.userToken = customToken;
    req.headers.authorization = 'Bearer '+customToken;
    
    return next();
  }, (error) => {
    console.log("Error creating custom token:", error);
    req.userToken = null;
    req.headers.authorization = null;
    return next();
  })
}

async function getUserByEmail(req, res, next){
  try{
    console.log(req.body.email)
    let userEmail = req.body.email ? req.body.email : req.params.email
    admin.auth().getUserByEmail(userEmail)
    .then((userRecord) => {
      // See the UserRecord reference doc for the contents of userRecord.
      
      req.user = userRecord;
      return next();
    }, (error) => {

      req.user = null;
      return next();
    });
  }
  catch(error){
    console.error("Email not exist!");
    req.user = null;
    return next();
  }
  
}



async function createUser(req, res, next){
  if (!req.user){
    try{
      if (req.body.email){
        admin.auth().createUser({
          email: req.body.email,
          emailVerified: true,
          password: req.body.password,
          displayName: req.body.displayName,
          photoURL: "http://konleng.com/assets/imgs/appicon.png",
          disabled: false
        })
        .then((userRecord) => {

          let user = {
            uid: userRecord.uid,
            email: userRecord.email,
            displayName: userRecord.displayName,
            photoURL: userRecord.photoURL,
            phone1: req.body.phone1 ? req.body['phone1'] : '',
            phone2: req.body.phone2 ? req.body['phone2'] : '',
            userType: req.body.userType ? req.body['userType'] : ''
          }
          firebaseHelper.firestore
          .createDocumentWithID(db, 'users', userRecord.uid, user).then((user) => {

            req.user = userRecord;
            return next();
          }, (error) => {
            console.error('FIREBASE FUNCTION ERROR CALLBACK ==> ', error);
          }).catch((error) => {
            console.error('FIREBASE FUNCTION ERROR PROMISE ==> ', error);
          });
        }, (error) => {
          req.error = error.message;
          console.error("Error creating new user:", error.message);
          res.status(400).json(error)
        });
      }
      else{
        res.send('ERROR CRATING USER: No Email Provided');
      }
      
    }
    catch(error){
      console.error("Error can't create user");
      req.error = error;
      return next();
    }
  }
  else{
    return next();
  }
}


exports.generateThumbnail = functions.storage.object().onFinalize((object) => {
  return new Promise((resolve, reject) =>{

    const fileBucket = object.bucket; // The Storage bucket that contains the file.
    const filePath = object.name; // File path in the bucket.
    const contentType = object.contentType; // File content type.
    const firebaseToken = object.metadata.firebaseStorageDownloadTokens;
    const downloadPath = encodeURIComponent(filePath);

    const downloadURL = `https://firebasestorage.googleapis.com/v0/b/${fileBucket}/o/${downloadPath}?alt=media&token=${firebaseToken}`;

    // Exit if this is triggered on a file that is not an image.
    if (!contentType.startsWith('image/')) {
      console.log('This is not an image.');
      return null;
    }

    // Get the file name.
    const fileName = path.basename(filePath);
    // Exit if the image is already a thumbnail.
    if (fileName.startsWith('thumb_')) {

      return null;
    }


    const bucket = storage.bucket(fileBucket)

    const currentTime = new Date().getTime();


    let fileNameThumb = 'listing_images/thumb_'+fileName;
    let fileThumb = bucket.file(fileNameThumb); 


    let request = require('request').defaults({ encoding: null });
    request(downloadURL, (err, res, body) => {
      const fileTypeRequest = fileType(body).mime;
      if (fileTypeRequest.startsWith('image')){

        sharp(body)
        .resize(300,300, {
          fit: "cover",
          kernel: sharp.kernel.lanczos2
        })
        .sharpen()
        .webp({
          quality: 90
        })
        .toFormat('jpeg')
        .toBuffer().then((imageBuffer) => {
          fileThumb.save(new Buffer(imageBuffer.toString('base64'), 'base64'),{
            metadata: { 
              contentType: 'image/jpeg', 
              public: true,
              validation: 'md5'
            },
            gzip: true,
            public: true
          }, (err2) => {
            if (!err2) {


              let thumbUrl = `https://storage.googleapis.com/${fileBucket}/${fileNameThumb}`;
              let listingId = fileName.split('_')[0];

              firebaseHelper.firestore.getDocument(db, listingsCollection, listingId).then((listing) => {

                //get listing thumbs;
                if (listing.thumbs){
                  listing.thumbs.push(thumbUrl);
                }
                else{
                  listing.thumbs = [thumbUrl];
                }

                let data = {
                  thumb: listing.thumbs[0]
                }

                firebaseHelper.firestore.updateDocument(db, listingsCollection, listingId, data).then((isUpdated) => {
                  if (isUpdated){


                    resolve('UPATED THUMBNAIL SUCCESSFULLY');

                  }
                  else{
                    reject(err2);
                    console.error('ERROR UPDATED THUMB IN IF'); 
                  }
                }).catch((error) => {
                  reject(error);
                  console.error('ERROR THUMB UPDATED CATCH ==> ', error);
                });
              });
              // Add Array

            }
            else{
              reject(err2);
              console.error('IF THUMB ERROR', err2);
            }
          });
        });
      }
      else{
        console.error('WRONG_MIME');
      }
    });
  });


});


app.use(require('cors')({origin: true}));

main.use(require('cors')({origin: true}));
main.use('/api/v1', app);
main.use(bodyParser.json());
main.use(bodyParser.urlencoded({ extended: false }));
// webApi is your functions name, and you will pass main as 
// a parameter
exports.webApi = functions.https.onRequest(main);


app.get('/users_by_email/:email', getUserByEmail, (req, res) => {
  res.json(req['user']);
})


function httpGet(url, callback) {

  let request = require('request').defaults({ encoding: null });
  
  request(url, (err, res, body) => {
    console.log('HttpGet Filetype =>', fileType(body).mime);
    callback(err, body);  
  });
}

function httpSaveImage(listing, key, callback){

  const storageId = functions.config().google ? functions.config().google.storage_id : process.env.google_storage_id
  
  const bucket = storage.bucket(storageId)
  let request = require('request').defaults({ encoding: null });


  const currentTime = new Date().getTime();

  let fileNameLarge = 'listing_images/'+listing.listingUuid+'_'+listing.imageIndex+'.jpeg';
  let fileLarge = bucket.file(fileNameLarge);    

  let fileNameThumb = 'listing_images/thumb_'+listing.listingUuid+'_'+listing.imageIndex+'.jpeg';
  let fileThumb = bucket.file(fileNameThumb);    

  // storageRef.child('images/stars.jpg').getDownloadURL().then(function(url) {
    //   // Get the download URL for 'images/stars.jpg'
    //   // This can be inserted into an <img> tag
    //   // This can also be downloaded directly
    // }).catch(function(error) {
      //   // Handle any errors
      // });

      const resize = size => sharp(listing.imageBuffer)
      .resize(size.width, size.height, {
        fit: "cover",
        kernel: sharp.kernel.lanczos2
      })
      .sharpen()
      .webp({
        quality: 90
      })
      .toFormat('jpeg')
      .toBuffer();
      Promise
      .all([{width: 1280, height: 800}, {width: 480, height: 300}].map(resize))
      .then((outputBuffer: Buffer[]) => {

        fileLarge.save(new Buffer(outputBuffer[0].toString('base64'), 'base64'),{
          metadata: { 
            contentType: 'image/jpeg', 
            public: true,
            validation: 'md5', 
            listingUuid: listing.listingUuid
          },
          gzip: true,
          public: true
        }, (err1) => {
          if (!err1) {
            let large: any;
            let thumb: any;

            large = `https://storage.googleapis.com/${storageId}/${fileNameLarge}`;

            fileThumb.save(new Buffer(outputBuffer[1].toString('base64'), 'base64'),{
              metadata: { 
                contentType: 'image/jpeg', 
                public: true,
                validation: 'md5', 
                listingUuid: listing.listingUuid
              },
              gzip: true,
              public: true
            }, (err2) => {
              if (!err2) {
                thumb = `https://storage.googleapis.com/${storageId}/${fileNameThumb}`;
                callback(err2, {large: large, thumb: thumb});
              }
              else{
                console.error('IF FILE_ERROR 2', err2);
              }
            });

          }
          else{
            console.error('ERROR 1', err1);
          }  
        });
      }).catch((errorSharp) => {
        callback(errorSharp, 'ERROR');
      });
    };

    function addCount(req, res, next){
      let listing_type = req.body.listing_type;
      let province = req.body.province;
      firebaseHelper.firestore.getDocument(db, 'counts', province).then((count) => {
        if (listing_type == 'sale'){
          count.sale = count.sale + 1;
        }
        if (listing_type == 'rent'){
          count.rent = count.rent + 1;
        }
        firebaseHelper.firestore.updateDocument(db, 'counts', province, count).then((isUpdated) => {
          if (isUpdated){
            return next();
          }
        }).catch((error) => {
          console.error('ERROR ADD COUNT ==> ', error);
          return next();

        });
      });
    }

    function minusCount(province, listing_type){
      firebaseHelper.firestore.getDocument(db, 'counts', province).then((count) => {
        if (listing_type == 'sale'){
          count.sale = count.sale + 1;
        }
        if (listing_type == 'rent'){
          count.rent = count.rent + 1;
        }
        firebaseHelper.firestore.updateDocument(db, 'counts', province, count).then((isUpdated) => {
          if (isUpdated){
            console.log('Count');
          }
        }).catch((error) => {
          console.error('ERROR ADD COUNT ==> ', error);
        });
      });
    }

    function requestImages(url){
      return new Promise((resolve, reject) =>{
        let request = require('request').defaults({ encoding: null });
        request(url, (err, res, body) => {
          resolve(body);  
        });  
      });
    }
    // Add new listing
    app.post('/crawl_listings', getUserByEmail, createUser, addCount, async (req, res) => {
      // app.post('/listings', async (req, res) => {
        let listingUuid = uuid();

        console.log("IMAGES ==> ");
        console.log(JSON.stringify(req.body['images']));

        let images = req.body['images'];
        if (images.length == 0){
          res.status(200).send("No Image, Skip Save");

        }
        else{

          async.map(images, httpGet, (err, body) => {

            if (err){

              res.json(err);
            }
            else{

              let listings: any = [];

              for (let i = 0; i < body.length; i ++){
                let img: any = body[i];
                const imageMimeType = fileType(img).mime;
                console.log('HttpGet Filetype =>', imageMimeType);
                if (imageMimeType.includes('image') == true){
                  listings.push({
                    listingUuid: listingUuid,
                    imageBuffer: img,
                    imageIndex: i + 1
                  });
                }
              }



              async.mapValues(listings, httpSaveImage, async (imgErr, imgUrl) => {
                console.log('HttpSaveImage');
                let imgThumbs = [];
                let imgLarges = [];
                let imgKeys = Object.keys(imgUrl)
                for (let i = 0; i < imgKeys.length; i ++){
                  imgThumbs.push(imgUrl[i]['thumb']);
                  imgLarges.push(imgUrl[i]['large']);
                }
                if (!imgErr){

                  let listing = {
                    title: req.body.title ? req.body['title'] : '',
                    price: req.body.price ? parseFloat(req.body['price']) : '',
                    property_type: req.body.property_type ? req.body['property_type'] : '',
                    listing_type: req.body.listing_type ? req.body['listing_type'] : '',
                    description: req.body.description ? req.body['description'] : '',
                    phone1: req.body.phone1 ? req.body['phone1'] : '',
                    phone2: req.body.phone2 ? req.body['phone2'] : '',
                    bedrooms: req.body.bedrooms ? parseInt(req.body.bedrooms) : 0,
                    bathrooms: req.body.bathrooms ? parseInt(req.body.bathrooms) : 0,
                    thumb: imgThumbs[0],
                    images: imgLarges,
                    province: req.body.province ? req.body['province'] : '',
                    lat: req.body.lat ? parseFloat(req.body['lat']) : '',
                    lng: req.body.lng ? parseFloat(req.body['lng']) : '',
                    "_geoloc": {
                      "lat": req.body.lat ? parseFloat(req.body['lat']) : '',
                      "lng": req.body.lng ? parseFloat(req.body['lng']) : '',
                    },
                    displayName: req.body.displayName ? req.body['displayName'] : '',
                    address: req.body.address ? req.body['address'] : 'Cambodia',
                    status: req.body.status ? parseInt(req.body['status']) : 1,
                    property_id: req.body.property_id ? req.body['property_id'] : makeid(),
                    userType: req.body.userType ? req.body['userType'] : '',
                    email: req['user'].email,
                    user_id: req['user'].uid,
                    size: req.body.size ? req.body['size'] : '',
                    link: req.body.link ? req.body['link'] : '',
                    created_date: new Date(),
                    modified_date: new Date(),
                    id: listingUuid
                  }



                  firebaseHelper.firestore
                  .createDocumentWithID(db, listingsCollection, listingUuid, listing).then(async (newListing) => {

                    console.log('createDocumentWithID');

                    let crawl_link = req.body.link ? req.body['link'] : '';
                    if (crawl_link){
                      firebaseHelper.firestore.createNewDocument(db, 'links', {link: crawl_link});
                    }

                    if (newListing){


                      listing['objectID'] = listingUuid;

                      const newestIndex = client.initIndex(ALGOLIA_NEWEST_INDEX);
                      await newestIndex.saveObject(listing);

                      res.status(200).send(listing);


                    }
                    else{
                      console.error('FAILED SAVE FIREBASE');
                      res.send('FIREBASE CREATE DOCUMENT'); 
                    }
                  }, (error) => {
                    res.status(400).send("ERROR CREATE DOCUMENT");
                  })
                }
                else{
                  console.error('Error Sharp Http Save Image ==> ', imgErr);
                  res.status(400).send("ERROR CREATE IMAGE");
                }
              });
            }
          });


}
})

app.post('/listings', addCount, async (req, res) => {

  let listing = {
    address: req.body.address ? req.body['address'] : '',
    air_conditioning: req.body.air_conditioning ? req.body['air_conditioning'] : false,
    balcony: req.body.balcony ? req.body['balcony'] : false,
    bathrooms: req.body.bathrooms ? parseFloat(req.body['bathrooms']) : '',
    bedrooms: req.body.bedrooms ? parseFloat(req.body['bedrooms']) : '',
    car_parking: req.body.car_parking ? req.body['car_parking'] : false,
    commune: req.body.commune ? req.body['commune'] : '',
    description: req.body.description ? req.body['description'] : '',
    displayName: req.body.displayName ? req.body['displayName'] : '',
    district: req.body.district ? req.body['district'] : '',
    email: req.body.email ? req.body['email'] : '',
    floor: req.body.floor ? parseFloat(req.body['floor']) : '',
    furnished: req.body.furnished ? req.body['furnished'] : false,
    garden: req.body.garden ? req.body['garden'] : false,
    gym_fitness: req.body.gym_fitness ? req.body['gym_fitness'] : false,
    id: req.body.id ? req.body['id'] : '',
    images: req.body.images ? req.body['images'] : '',
    in_development_area: req.body.in_development_area ? req.body['in_development_area'] : false,
    lat: req.body.lat ? parseFloat(req.body['lat']) : '',
    lift: req.body.lift ? req.body['lift'] : '',
    listing_type: req.body.listing_type ? req.body['listing_type'] : '',
    lng: req.body.lng ? parseFloat(req.body['lng']) : '',
    "_geoloc": {
      "lat": req.body.lat ? parseFloat(req.body['lat']) : '',
      "lng": req.body.lng ? parseFloat(req.body['lng']) : '',
    },
    non_flooding: req.body.non_flooding ? req.body['non_flooding'] : false,
    on_main_road: req.body.on_main_road ? req.body['on_main_road'] : false,
    other: req.body.other ? req.body['other'] : false,
    parking_space: req.body.parking_space ? parseFloat(req.body['parking_space']) : '',
    phone1: req.body.phone1 ? req.body['phone1'] : '',
    phone2: req.body.phone2 ? req.body['phone2'] : '',
    price: req.body.price ? parseFloat(req.body['price']) : '',
    property_type: req.body.property_type ? req.body['property_type'] : '',
    province: req.body.province ? req.body['province'] : '',
    shareListing: req.body.shareListing ? req.body['shareListing'] : '',
    size: req.body.size ? parseFloat(req.body['size']) : '',
    swimming_pool: req.body.swimming_pool ? req.body['swimming_pool'] : false,
    thumb: req.body.thumb ? req.body['thumb'] : '',
    title: req.body.title ? req.body['title'] : '',
    user_id: req.body.user_id ? req.body['user_id'] : '',
    user_name: req.body.user_name ? req.body['user_name'] : '',
    user_type: req.body.user_type ? req.body['user_type'] : '',
    created_date: new Date(),
    modified_date: new Date(),
    status: 1
  }
 

  console.log(JSON.stringify(listing));
  firebaseHelper.firestore
  .createDocumentWithID(db, listingsCollection, listing.id, listing).then(async (newListing) => {

    console.log('createDocumentWithID', JSON.stringify(newListing));

    if (newListing){

      listing['objectID'] = listing.id;

      const newestIndex = client.initIndex(ALGOLIA_NEWEST_INDEX);
      await newestIndex.saveObject(listing);

      res.status(200).send(listing);


    }
    else{
      console.error('FAILED SAVE FIREBASE');
      res.send('FIREBASE CREATE DOCUMENT'); 
    }
  }, (error) => {
    res.status(400).send("ERROR CREATE DOCUMENT");
  })

})
// Update new listing
app.patch('/listings/:listingId', getUserByEmail, createUser, (req, res) => {
  let listing = {
    title: req.body.title ? req.body['title'] : '',
    price: req.body.price ? parseFloat(req.body['price']) : '',
    property_type: req.body.property_type ? req.body['property_type'] : '',
    listing_type: req.body.listing_type ? req.body['listing_type'] : '',
    description: req.body.description ? req.body['description'] : '',
    phone1: req.body.phone1 ? req.body['phone1'] : '',
    phone2: req.body.phone2 ? req.body['phone2'] : '',
    bedrooms: req.body.bedrooms ? parseInt(req.body['bedrooms']) : '',
    bathrooms: req.body.bathrooms ? parseInt(req.body['bathrooms']) : '',
    images: req.body.images ? req.body['images'] : '',
    province: req.body.province ? req.body['province'] : '',
    lat: req.body.lat ? parseFloat(req.body['lat']) : '',
    lng: req.body.lng ? parseFloat(req.body['lng']) : '',
    displayName: req.body.displayName ? req.body['displayName'] : '',
    address: req.body.address ? req.body['address'] : '',
    status: req.body.status ? parseInt(req.body['status']) : '',
    property_id: req.body.property_id ? req.body['property_id'] : '',
    userType: req.body.userType ? req.body['userType'] : '',
    email: req['user'].email,
    user_id: req['user'].uid,
    size: req.body.size ? req.body['size'] : ''
  }
  firebaseHelper.firestore
  .updateDocument(db, listingsCollection, req.params.listingId, listing).then(function(docRef){
    let listing = req.body;
    listing.objectID = req.params.listingId;




    const newestIndex = client.initIndex(ALGOLIA_NEWEST_INDEX);
    newestIndex.saveObject(listing);

    res.json(req.params.listingId);
  });
  res.json({'msg': 'listing updated'});
})
// View a listing
app.get('/listings/:listingId', (req, res) => {
  firebaseHelper.firestore
  .getDocument(db, listingsCollection, req.params.listingId)
  .then(function(doc) {

    res.json(doc);
  });
})

app.get('/users/:uid', (req, res) => {
  firebaseHelper.firestore
  .getDocument(db, usersCollection, req.params.uid)
  .then(function(doc) {
    res.json(doc);
  });
})

app.get('/users/:uid/listings', (req, res) => {
  let userId = req.params.uid;
  const dataRef = db.collection('listings');

  let queryRef = dataRef.where('user_id', '==', userId);
  
  let status = req.query.status ? req.query.status : 1; 
  console.log('status', status);
  queryRef = queryRef.where('status', '==', parseInt(status));
  // queryRef = queryRef.orderBy('created_date', 'desc');

  const results = {};
  const sliceResults = {};
  let size = 0;
  let keys:any;
  queryRef.get()
  .then(snapshot => {
    snapshot.forEach(doc => {
      results[doc.id] = doc.data();
    });
    if (Object.keys(results).length > 0) {
      res.json(results);
    }
  });
  
})

app.post('/users', (req, res) => {
  try{
    if (req.body.email){
      admin.auth().createUser({
        email: req.body.email,
        emailVerified: true,
        password: req.body.password,
        displayName: req.body.displayName,
        photoURL: req.body.photoURL ? req.body.photoURL : "http://konleng.com/assets/imgs/appicon.png",
        disabled: false
      })
      .then((userRecord) => {
        let user = {
          uid: userRecord.uid,
          email: userRecord.email,
          displayName: userRecord.displayName,
          photoURL: userRecord.photoURL,
          phone1: req.body.phone1 ? req.body['phone1'] : '',
          phone2: req.body.phone2 ? req.body['phone2'] : '',
          user_type: req.body.user_type ? req.body['user_type'] : '',
          user_role: req.body.user_role ? req.body['user_role'] : '',
          company_name: req.body.company_name ? req.body['company_name'] : '',
          province: req.body.province ? req.body['province'] : '',
          district: req.body.district ? req.body['district'] : '',
          commune: req.body.commune ? req.body['commune'] : '',
          address: req.body.address ? req.body['address'] : '',
          lat: req.body.lat ? req.body['lat'] : '',
          lng: req.body.lng ? req.body['lng'] : ''
        }
        firebaseHelper.firestore
        .createDocumentWithID(db, 'users', userRecord.uid, user).then((user) => {
          res.json(userRecord);
        }, (error) => {
          console.error('FIREBASE FUNCTION ERROR CALLBACK ==> ', error);
        }).catch((error) => {
          console.error('FIREBASE FUNCTION ERROR PROMISE ==> ', error);
        });
      }, (error) => {
        console.error("Error creating new user:", error.message);
        res.status(400).json(error)
      });
    }
    else{
      res.send('ERROR CRATING USER: No Email Provided');
    }

  }
  catch(error){
    console.error("Error can't create user");
    
  }
});

app.get('/all_users', (req, res) => {
  admin.auth().listUsers().then((results: any) => {
    
    // console.log(JSON.stringify(results.users.length));
    for (let i = 0; i < results.users.length; i ++){
        var userId = results.users[i]['uid'];
        admin.auth().deleteUser(userId)
        .then((result) => {
          console.log('delete success', JSON.stringify(result));
        })
        .catch((error) => {
          console.log('error delete', JSON.stringify(error));
        });
    }
    
    
    
  })
});

app.delete('/users/:userId', (req, res) => {
  var userId = req.params.userId;
  admin.auth().deleteUser(userId)
  .then((result) => {
    res.json('delete success');
  })
  .catch((error) => {
    console.error('There was an error while deleting user:', error)
    res.json('delete error');
  });
  // firebaseHelper.firestore
  // .document('users/{userID}')
  // .onDelete((snap, context) => {
  //   console.log('snapid', snap.id);
  //   admin.auth().deleteUser(snap.id)
  //   .then(() => {
  //     console.log('Deleted user with ID:' + snap.id);
  //   })
  //   .catch((error) => {
  //     console.error('There was an error while deleting user:', error)
  //   });
  // });
});


// View a listing
app.get('/devices', (req, res) => {
 const dataRef = db.collection('devices');

  // const province = req.body['province'];

  
  // let queryRef = dataRef.where('property_type', '==', property_type);
  // queryRef = queryRef.where('listing_type', '==', listing_type);
  // queryRef = queryRef.orderBy('created_date', 'desc');
// res.send("HELLO");
  let results = [];

  dataRef.get()
  .then(snapshot => {
    snapshot.forEach(doc => {
      results[doc.id] = doc.data();
      console.log(doc.id);
    });
    console.log(Object.keys(results).length);
    res.send(Object.keys(results).length.toString());
  });
})

function httpGetImport(url, callback) {

  let request = require('request').defaults({ encoding: null });
  
  request(url, (err, res, body) => {
    let data = JSON.parse(body.toString());
    let objectIds = Object.keys(data);
    let batchActions = [];
    for (let objectId of objectIds){
      console.log('objectId', objectId);
      if (data[objectId]['lat'] && data[objectId]['lng']){
        batchActions.push({
          "action": 'partialUpdateObjectNoCreate',
          "indexName": ALGOLIA_NEWEST_INDEX,
          "body": {
            "objectID": objectId,
            "_geoloc": {
              "lat": parseFloat(data[objectId]['lat']),
              "lng": parseFloat(data[objectId]['lng'])
            }
          }
        })
      }
    }
    // let keys = Object.keys(body);
    const newestIndex = client.initIndex(ALGOLIA_NEWEST_INDEX);
    client.batch(batchActions, (err, content) => {
      console.log('url', url);
      callback(err, content);  
    });
    
  });
}

app.get('/import', (req, response) =>{


  // let url = 'https://storage.googleapis.com/konleng-cloud.appspot.com/phnom-penh_0_900.json';
  // let url = 'https://storage.googleapis.com/konleng-cloud.appspot.com/phnom-penh_900_1800.json';
  // let url = 'https://storage.googleapis.com/konleng-cloud.appspot.com/phnom-penh_1800_2700.json';
  // let url = 'https://storage.googleapis.com/konleng-cloud.appspot.com/phnom-penh_2700_3600.json';
  // let url = 'https://storage.googleapis.com/konleng-cloud.appspot.com/phnom-penh_3600_4500.json';
  // let url = 'https://storage.googleapis.com/konleng-cloud.appspot.com/phnom-penh_4500_5400.json';
  // let url = 'https://storage.googleapis.com/konleng-cloud.appspot.com/phnom-penh_5400_6300.json';

  var urls = [
  'https://storage.googleapis.com/konleng-cloud.appspot.com/banteay-meanchey.json',
  'https://storage.googleapis.com/konleng-cloud.appspot.com/battambang.json',
  'https://storage.googleapis.com/konleng-cloud.appspot.com/kampong-cham.json',
  'https://storage.googleapis.com/konleng-cloud.appspot.com/kampong-chhnang.json',
  'https://storage.googleapis.com/konleng-cloud.appspot.com/kampong-speu.json',
  'https://storage.googleapis.com/konleng-cloud.appspot.com/kampot.json',
  'https://storage.googleapis.com/konleng-cloud.appspot.com/kandal.json',
  'https://storage.googleapis.com/konleng-cloud.appspot.com/kep.json',
  'https://storage.googleapis.com/konleng-cloud.appspot.com/preah-sihanouk.json',
  'https://storage.googleapis.com/konleng-cloud.appspot.com/pursat.json',
  'https://storage.googleapis.com/konleng-cloud.appspot.com/siem-reap.json',
  'https://storage.googleapis.com/konleng-cloud.appspot.com/svay-rieng.json',
  'https://storage.googleapis.com/konleng-cloud.appspot.com/takeo.json',
  'https://storage.googleapis.com/konleng-cloud.appspot.com/tboung-khmum.json'];

  var urls = ["https://firebasestorage.googleapis.com/v0/b/konleng-cloud.appspot.com/o/phnom-penh-import.json?alt=media&token=0f437ef0-67e5-4da1-80b5-a685bb04e890"];
  // firebaseHelper.firestore.restore(db, 'import.json').then((response) => {
  //   console.log(JSON.stringify(response));
  // });
  
  
  // const word = (<any>data);
  // console.log('word', JSON.stringify(listingData['listings']));
  let data = listingData['listings'];
  let objectIds = Object.keys(data);
  let batchActions = [];
  for (let objectId of objectIds){
    // console.log('objectId', objectId);
    if (data[objectId]['lat'] && data[objectId]['lng']){
      batchActions.push({
        "action": 'updateObject',
        "indexName": ALGOLIA_NEWEST_INDEX,
        "body": {
          "objectID": objectId,
          "_geoloc": {
            "lat": parseFloat(data[objectId]['lat']),
            "lng": parseFloat(data[objectId]['lng'])
          },
          "userType": data[objectId]['userType'],
          "property_id": data[objectId]['property_id'],
          "description": data[objectId]['description'],
          "listing_type": data[objectId]['listing_type'],
          "lat": parseFloat(data[objectId]['lat']),
          "lng": parseFloat(data[objectId]['lng']),
          "link": data[objectId]['link'],
          "email": data[objectId]['email'],
          "id": data[objectId]['id'],
          "phone2": data[objectId]['phone2'],
          "property_type": data[objectId]['property_type'],
          "user_id": data[objectId]['user_id'],
          "displayName": data[objectId]['displayName'],
          "thumb": data[objectId]['thumb'],
          "phone1": data[objectId]['phone1'],
          "province": data[objectId]['province'],
          "images": data[objectId]['images'],
          "price": parseFloat(data[objectId]['price']),
          "bathrooms": parseFloat(data[objectId]['bathrooms']),
          "address": data[objectId]['address'],
          "bedrooms": parseFloat(data[objectId]['bedrooms']),
          "status": parseFloat(data[objectId]['status']),
          "size": parseFloat(data[objectId]['size']),
          "title": data[objectId]['title']
        }
      })
    }
  }
  // let keys = Object.keys(body);
  const newestIndex = client.initIndex(ALGOLIA_NEWEST_INDEX);
  client.batch(batchActions, (err, content) => {
    if (err){
      console.log('ERROR', JSON.stringify(err));
      response.send('ERROR');
    }
    else{
      console.log('content', JSON.stringify(content));
      response.send('SUCCESS');
    }
  });
  // async.map(urls, httpGetImport, (err, body) => {
  //   if (err){
  //     response.send(err);
  //   }
  //   response.send('SUCCESS');
  // });

  // let request = require('request').defaults({ encoding: null });

  // request(url, (err, res, body) => {
    //   let data = JSON.parse(body.toString());
    //   let objectIds = Object.keys(data);
    //   let batchActions = [];
    //   for (let objectId of objectIds){
      //     if (data[objectId]['lat'] && data[objectId]['lng']){
        //       batchActions.push({
          //         "action": 'partialUpdateObjectNoCreate',
          //         "indexName": ALGOLIA_NEWEST_INDEX,
          //         "body": {
            //           "objectID": objectId,
            //           "_geoloc": {
              //             "lat": parseFloat(data[objectId]['lat']),
              //             "lng": parseFloat(data[objectId]['lng'])
              //           }
              //         }
              //       })
              //     }
              //   }
              //   // let keys = Object.keys(body);
              //   const newestIndex = client.initIndex(ALGOLIA_NEWEST_INDEX);
              //   client.batch(batchActions, (err, content) => {
                //     response.send('SUCCESS');
                //   });

                // })
              });

app.post('/export', (req, res) =>{
  const dataRef = db.collection('listings');

  // const province = req.body['province'];

  const property_type = 'room';
  const listing_type = '';
  let queryRef = dataRef.where('property_type', '==', property_type);
  // queryRef = queryRef.where('listing_type', '==', listing_type);
  // queryRef = queryRef.orderBy('created_date', 'desc');

  const results = {};
  const sliceResults = {};
  let size = 0;
  let keys:any;
  queryRef.get()
  .then(snapshot => {
    snapshot.forEach(doc => {
      results[doc.id] = doc.data();
    });
    if (Object.keys(results).length > 0) {
      keys = Object.keys(results);
      size = keys.length

      // var startIndex = 1800;
      // var endIndex = 2700;
      // var slice = keys.slice(startIndex, endIndex);
      // for (var i = 0; i < slice.length; i ++){
      //   sliceResults[slice[i]] = results[slice[i]];
      // }

      var jsonData = JSON.stringify(results, null, 4);
      var storageId = functions.config().google ? functions.config().google.storage_id : process.env.google_storage_id
      var bucket = storage.bucket(storageId);
      // var filenameListing = listing_type+'_'+property_type+'_'+province+startIndex+'-'+endIndex+'.json';
      var filenameListing = property_type+'_'+listing_type+'.json';
      var bucketFile = bucket.file(filenameListing);    
      bucketFile.save(Buffer.from(jsonData),{
        metadata: { 
          contentType: 'application/json', 
          public: true
        },
        gzip: true,
        public: true
      }, (err2) => {
        bucketFile.getSignedUrl({
            action: 'read',
            expires: new Date('03-09-2491').getTime()
        }).then((url) => {
          res.status(200).send(url);
        })
        

      });

    }
    else {
      res.status(200).send('No Result');
    }
  }).catch((error) => {
    res.status(200).send(error);
    console.log(error);
  });
})


app.post('/check_link', (req, res) =>{
  const queryArray = ['link', '==', req.body.link]; 
  firebaseHelper.firestore.queryData(db, 'links', queryArray).then((response) => {

    let result = Object.keys(response);

    if (result.length > 0 && result.length < 16){
      res.status(200).send(true);  
    }
    else{
      res.status(200).send(false);   
    }


  }).catch((error) => {
    console.error('error document');
    res.status(400).json(error);
  });
})

app.get('/indexing', async (req, res) => {

  const searchableAttributes = [
  'title',
  'description', 
  'price', 
  'province', 
  'property_type', 
  'listing_type', 
  'district', 
  'address', 
  'lat', 
  'lng', 
  'size', 
  'status',
  'created_date', 
  'bedrooms',
  'bathrooms',
  'id',
  'user_id',
  'property_id',
  '_geoloc'
  ];

  const attributesForFaceting = [
  'searchable(province)', 
  'searchable(title)',
  'searchable(description)', 
  'searchable(address)', 
  'searchable(property_type)', 
  'searchable(listing_type)', 
  'searchable(district)', 
  'searchable(price)', 
  'searchable(size)', 
  'searchable(status)',
  'searchable(_geoloc)'
  ];

  const attributesToRetrieve = [
  'province', 
  'title',
  'description', 
  'address', 
  'property_type', 
  'listing_type',
  'district', 
  'price', 
  'lat', 
  'lng', 
  'thumb', 
  'bedrooms',
  'bathrooms',
  'created_date', 
  'size', 
  'images', 
  'status',
  'id',
  'user_id',
  'property_id',
  '_geoloc'
  ];


  const indexSettings = {
    searchableAttributes: searchableAttributes,
    attributesForFaceting: attributesForFaceting,
    attributesToRetrieve: attributesToRetrieve,
    ranking: [],
  } as IndexSettings;

  const newestIndex = client.initIndex(ALGOLIA_NEWEST_INDEX);
  let newestSetting = indexSettings;
  newestSetting.ranking = ['desc(created_date)', 'custom'];
  await newestIndex.setSettings(newestSetting);

  // const oldestIndex = client.initIndex(ALGOLIA_OLDEST_INDEX);
  // let oldestSetting = indexSettings;
  // oldestSetting.ranking = ['asc(created_date)', 'custom'];
  // await oldestIndex.setSettings(oldestSetting);

  // const highestIndex = client.initIndex(ALGOLIA_HIGHEST_INDEX);
  // let highestSetting = indexSettings;
  // highestSetting.ranking = ['desc(price)', 'custom'];
  // await highestIndex.setSettings(highestSetting);

  // const cheapestIndex = client.initIndex(ALGOLIA_CHEAPEST_INDEX);
  // let cheapestSetting = indexSettings;
  // cheapestSetting.ranking = ['asc(price)', 'custom'];
  // await cheapestIndex.setSettings(cheapestSetting);

  res.status(200).send(true);  
});
// View all listings
app.get('/listings', async (req, res) =>{


  let query = req.query.q;
  let province = req.query.province;
  let district = req.query.district;
  let listing_type = req.query.listing_type;
  let property_type = req.query.property_type;
  let min_price = req.query.min_price;
  let max_price = req.query.max_price;
  let sort_by = req.query.sort_by ? req.query.sort_by : 'desc(created_date)';
  let page = req.query.page;
  let latlng = req.query.latlng ? req.query.latlng : '';


  if (page == 1){
    page = 0;
  }

  let querySearch: QueryParameters = {
    query: '',
    filters: '',
    hitsPerPage: 200,
    page: page
  };
  if (query){
    querySearch.query = query;
  }

  // let filters = [];
  let filters = ['status:1'];

  if (province){
    filters.push('province:'+province+'');
  }
  if (district){
    filters.push('district:'+district+'');
  }
  if (listing_type){
    filters.push('listing_type:'+listing_type+'');
  }
  if (property_type){
    filters.push('property_type:'+property_type+'');
  }
  if (min_price && !max_price){
    filters.push('price > '+ min_price);
  }
  if (!min_price && max_price){
    filters.push('price < '+ max_price);
  }
  if (min_price && max_price){
    filters.push('price:'+min_price+' TO '+max_price);
  }
  if (latlng){
    let polygon = latlng.split(',');
    let polyFloat = [];
    for (let i = 0; i < polygon.length; i ++){
      polyFloat.push(parseFloat(polygon[i]));
    }
    querySearch.insidePolygon = [polyFloat];
    // querySearch.aroundLatLng = latlng;
    // querySearch.aroundRadius = 10000 // 10km
  }
  
  
  querySearch.filters = filters.join(' AND ');

  console.log(filters.join(' AND '));

  // if (sort_by == 'newest'){
    const newestIndex = client.initIndex(ALGOLIA_NEWEST_INDEX);
    newestIndex.search(querySearch, function (err, content) {
      if (err) throw err;
      res.status(200).send(content);
    });


  })
app.get('/backup', (req, res) => {
  var obj = {
    table: []
  };

  obj.table.push({id: 1, square:2});

  var json = JSON.stringify(obj);

  var fs = require('fs');
  fs.writeFile('myjsonfile.json', json, 'utf8', () => {
    res.status(200).send('write finish');
  });

})

app.delete('/delete', (req, res) => {
  // const oldestIndex = client.deleteIndex(ALGOLIA_CHEAPEST_INDEX, function(err, content) {
    // if (err) throw err;
    res.status(200).send('success');
    // });
  })


// // Delete a listing 
// app.delete('/listings/:listingId', async (req, res) => {


  //   const newestIndex = client.initIndex(ALGOLIA_NEWEST_INDEX);
  //   newestIndex.deleteObject(req.params.listingId);

  //   // const oldestIndex = client.initIndex(ALGOLIA_OLDEST_INDEX);
  //   // oldestIndex.deleteObject(req.params.listingId);

  //   // const highestIndex = client.initIndex(ALGOLIA_HIGHEST_INDEX);
  //   // highestIndex.deleteObject(req.params.listingId);

  //   // const cheapestIndex = client.initIndex(ALGOLIA_CHEAPEST_INDEX);
  //   // cheapestIndex.deleteObject(req.params.listingId);

  //   res.json({'msg': 'listing deleted'});
  // })





  // const app = require('express')();

  // app.use(require('cors')({origin: true}));

  // app.use(getFirebaseUser);


  // app.get('/', (req, res) => {
    //   const params = {
      //     filters: `author:${req.user.user_id}`,
      //     userToken: req.user.user_id,
      //   };
      //   const key = client.generateSecuredApiKey(ALGOLIA_SEARCH_KEY, params);
      //   res.json({key});
      // });

      // exports.getSearchKey = functions.https.onRequest(app);

