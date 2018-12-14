/// <reference path="node_modules/google-maps-api-typings/index.d.ts" />
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



import * as maps from "@google/maps";

const map = maps.createClient({
  key: functions.config().google ? functions.config().google.api_key : process.env.google_api_key,
  Promise: Promise
});




// const bucket = storage.bucket('konleng-firebase.appspot.com')

const serviceAccount = require('./serviceAccountKey.json');
const databaseURL = functions.config().google ? functions.config().google.firebase_database_url : process.env.google_firebase_database_url;
const appFirestore = firebaseHelper.firebase.initializeApp(serviceAccount, databaseURL);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: databaseURL
});


const db = appFirestore.firestore;
db.settings({ timestampsInSnapshots: true });
const app = express();
const main = express();
const listingsCollection = "listings";

// [START init_algolia]
// Initialize Algolia, requires installing Algolia dependencies:
// https://www.algolia.com/doc/api-client/javascript/getting-started/#install
//
// App ID and API Key are stored in functions config variables


const ALGOLIA_ID = functions.config().algolia ? functions.config().algolia.app_id : process.env.algolia_app_id;
const ALGOLIA_ADMIN_KEY = functions.config().algolia ? functions.config().algolia.api_key : process.env.algolia_api_key;
const ALGOLIA_SEARCH_KEY = functions.config().algolia ? functions.config().algolia.search_key : process.env.algolia_search_key;

const ALGOLIA_INDEX_NAME = 'listings';
const client = algoliasearch(ALGOLIA_ID, ALGOLIA_ADMIN_KEY);
// [END init_algolia]




exports.onListingUpdated = functions.firestore.document('listings/{listingId}').onUpdate((snap, context) => {
  console.log('ON_LISTING_UPDATE');
  const listing = snap.after.data();

  listing.objectID = context.params.listingId;

  const index = client.initIndex(ALGOLIA_INDEX_NAME);
  return index.saveObject(listing);
});


exports.onListingDeleted = functions.firestore.document('listings/{listingId}').onDelete((snap, context) => {
  // const listing = snap.data();
  const index = client.initIndex(ALGOLIA_INDEX_NAME);
  return index.deleteObject(context.params.listingId);
});


// [START get_firebase_user]
async function getFirebaseUser(req, res, next) {
  console.log("Check if request is authorized with Firebase ID token");

  if (!req.headers.authorization || !req.headers.authorization.startsWith('Bearer ')) {
    console.error(
      'No Firebase ID token was passed as a Bearer token in the Authorization header.',
      'Make sure you authorize your request by providing the following HTTP header:',
      'Authorization: Bearer <Firebase ID Token>'
      );
    return res.sendStatus(403);
  }

  let idToken;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    console.log('Found \'Authorization\' header');
    idToken = req.headers.authorization.split('Bearer ')[1];
  }

  try {
    const decodedIdToken = admin.auth().verifyIdToken(req.userToken).then((user) => {
      console.log('Token generated: ', user);
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
    console.log('userToken ==> ', req.userToken);
    console.log('headers.authorization ==> ', req.headers.authorization);
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
    admin.auth().getUserByEmail(req.body.email)
    .then((userRecord) => {
      // See the UserRecord reference doc for the contents of userRecord.
      console.log("Successfully fetched user data:", userRecord.toJSON());
      req.user = userRecord;
      return next();
    }, (error) => {
      console.error("Error fetching user data: Email: " + req.body.email + " Error: ", error);
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
      console.log('EMAIL =====> ', req.body.email);
      if (req.body.email){
        admin.auth().createUser({
          email: req.body.email,
          emailVerified: true,
          password: Math.random().toString(36).slice(-8),
          displayName: req.body.displayName,
          photoURL: "http://konleng.com/assets/imgs/appicon.png",
          disabled: false
        })
        .then((userRecord) => {
          console.log("FIREBASE AUTH CREATE USER ===>", userRecord);
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
            console.log("FIREBASE FUNCTION HELPER Created User ==>", user);
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

async function reverseGeocode(req, res, next) {
  let address = req.body['address'] ? req.body['address'] : null;
  if (!req.body['address']){

    let lat = req.body.lat ? parseFloat(req.body['lat']) : 0;
    let lng = req.body.lng ? parseFloat(req.body['lng']) : 0;

    let map_location: maps.LatLng = {lat: lat, lng: lng};

    try{
      await map.reverseGeocode({
        latlng: map_location
      })
      .asPromise()
      .then((expectOK) => {

        req.body.address = expectOK.json.results[0].formatted_address;
        console.log('SUCCESS Google Map', address);
        return next();
      }, (error) => {
        console.error('Error Map ', error);
        return next();
      });
    }catch(error){
      console.error('Error Map Try Catch', error);
      return next();
    }
  }
}


app.use(require('cors')({origin: true}));

main.use(require('cors')({origin: true}));
main.use('/api/v1', app);
main.use(bodyParser.json());
main.use(bodyParser.urlencoded({ extended: false }));
// webApi is your functions name, and you will pass main as 
// a parameter
exports.webApi = functions.https.onRequest(main);


app.get('/users/:email', getUserByEmail, (req, res) => {
  res.json(req['user']);
})


function httpGet(url, callback) {

  let request = require('request').defaults({ encoding: null });
  console.log('URL ==> ', url);
  request(url, (err, res, body) => {
    callback(err, body);
  });
}

function httpSaveImage(listing, key, callback){

  const storageId = functions.config().google ? functions.config().google.storage_id : process.env.google_storage_id
  console.log('STORAGE_ID ===> ', storageId);
  const bucket = storage.bucket(storageId)
  let request = require('request').defaults({ encoding: null });


  const currentTime = new Date().getTime();

  let fileNameLarge = 'listing_images/'+listing.listingUuid+'_'+listing.imageIndex+'.jpeg';
  let fileLarge = bucket.file(fileNameLarge);    

  let fileNameThumb = 'listing_images/thumb_'+listing.listingUuid+'_'+listing.imageIndex+'.jpeg';
  let fileThumb = bucket.file(fileNameThumb);    

  
  

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
        fileLarge.getSignedUrl({
          action: 'read',
          expires: new Date('03-01-2500').getTime(),
        }).then((results) => {
          large = results[0];

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
              fileThumb.getSignedUrl({
                action: 'read',
                expires: new Date('03-01-2500').getTime(),
              }).then((results) => {
                thumb = results[0];
                callback(err2, {large: large, thumb: thumb});
              }, (error) =>{
                console.error('CATCH FILE_ERROR 2 ==> ', error);
                callback(error, 'ERROR');
              });
            }
            else{
              console.error('IF FILE_ERROR 2', err2);
            }
          });
        })
      }
      else{
        console.error('ERROR 1', err1);
      }  
    });
  }).catch((errorSharp) => {
    callback(errorSharp, 'ERROR');
  });
};



// Add new listing
app.post('/listings', getUserByEmail, createUser, reverseGeocode, async (req, res) => {
  let listingUuid = uuid();

  async.map(req.body['images'], httpGet, (err, body) => {
    console.log('BODY AFTER GET => ', body);
    if (err){
      console.error('ERROR GET IMAGE ==> ', err);
      res.json(err);
    }
    else{

      let listings: any = [];

      for (let i = 0; i < body.length; i ++){
        let img: any = body[i];
        const imageMimeType = fileType(img).mime;
        if (imageMimeType.includes('image') == true){
          listings.push({
            listingUuid: listingUuid,
            imageBuffer: img,
            imageIndex: i + 1
          });
        }
      }

      

      async.mapValues(listings, httpSaveImage, async (imgErr, imgUrl) => {
        console.log('imgUrl ==> ', imgUrl);

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
            bedrooms: req.body.bedrooms ? parseInt(req.body['bedrooms']) : '',
            bathrooms: req.body.bathrooms ? parseInt(req.body['bathrooms']) : '',
            thumb: imgThumbs,
            images: imgLarges,
            province: req.body.province ? req.body['province'] : '',
            lat: req.body.lat ? parseFloat(req.body['lat']) : '',
            lng: req.body.lng ? parseFloat(req.body['lng']) : '',
            displayName: req.body.displayName ? req.body['displayName'] : '',
            address: req.body.address ? req.body['address'] : 'Cambodia',
            status: req.body.status ? parseInt(req.body['status']) : 1,
            property_id: makeid(),
            userType: req.body.userType ? req.body['userType'] : '',
            email: req['user'].email,
            user_id: req['user'].uid,
            size: req.body.size ? req.body['size'] : '',
            link: req.body.link ? req.body['link'] : '',
            created_date: new Date(),
            modified_date: new Date()
          }

          firebaseHelper.firestore
          .createDocumentWithID(db, listingsCollection, listingUuid, listing).then((newListing) => {
            let crawl_link = req.body.link ? req.body['link'] : '';
            if (crawl_link){
              firebaseHelper.firestore.createNewDocument(db, 'links', {link: crawl_link});
            }


            if (newListing){
              console.log('new Listing ===> ');
              console.log(newListing);
              console.log('end Listing ==> ');
              listing['objectID'] = listingUuid;
              const index = client.initIndex(ALGOLIA_INDEX_NAME);
              listing.thumb = listing.thumb[0];
              delete listing.images;

              index.saveObject(listing).then((response) => {
                console.log('SUCCESS ALGOLIA ==> ', response);
                res.send(response);
              }, (error) => {
                console.error('ERROR ALGOLIA ==> ', error.message);
                res.send(error.message);
              });

            }
            else{
              console.error('FAILED SAVE FIREBASE');
              res.send('FIREBASE CREATE DOCUMENT'); 
            }
          })
        }
        else{
          console.error('Error Sharp Http Save Image ==> ', imgErr);
          res.json(imgErr);
        }
      });
    }
  });


  // res.status(200).send('success created')



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
    const index = client.initIndex(ALGOLIA_INDEX_NAME);
    index.saveObject(listing);
    res.json(req.params.listingId);
  });
  res.json({'msg': 'listing updated'});
})
// View a listing
app.get('/listings/:listingId', (req, res) => {
  firebaseHelper.firestore
  .getDocument(db, listingsCollection, req.params.listingId)
  .then(function(doc) {
    console.log(doc);
    res.json(doc);
  });
})

app.post('/import', (req, res) =>{
  firebaseHelper.firestore.restore(db, './listing.json').then((success) => {
    console.info(success);
  }).catch(function(error) {
    console.error(error);
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


// View all listings
app.get('/listings', async (req, res) =>{

  let query = req.query.q;
  let province = req.query.province;
  let district = req.query.district;
  let listing_type = req.query.listing_type;
  let property_type = req.query.property_type;
  let minprice = req.query.minprice;
  let maxprice = req.query.maxprice;

  let querySearch: QueryParameters = {
    query: '',
    filters: ''
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
  if (minprice && !maxprice){
    filters.push('price > '+ minprice);
  }
  if (!minprice && maxprice){
    filters.push('price < '+ maxprice);
  }
  if (minprice && maxprice){
    filters.push('price:'+minprice+' TO '+maxprice);
  }


  querySearch.filters = filters.join(' AND ');

  // console.log('QUERYSEARCH ==> ', querySearch);

  const index = client.initIndex(ALGOLIA_INDEX_NAME);
  let indexSetting: IndexSettings = {
    searchableAttributes: [
    'address', 
    'title',
    'description', 
    'province', 
    'property_type', 
    'listing_type', 
    'district', 
    'price', 
    'lat', 
    'lng', 
    'size', 
    'status',
    'ordered(created_date)'
    ],
    attributesForFaceting: [
    'searchable(address)', 
    'searchable(title)',
    'searchable(description)', 
    'searchable(province)', 
    'searchable(property_type)', 
    'searchable(listing_type)', 
    'searchable(district)', 
    'searchable(price)', 
    'searchable(size)', 
    'searchable(status)'
    ],
    attributesToRetrieve: [
    'address', 
    'title',
    'description', 
    'province', 
    'property_type', 
    'listing_type',
    'district', 
    'price', 
    'lat', 
    'lng', 
    'thumb', 
    'created_date', 
    'size', 
    'images', 
    'status'
    ]
  }
  index.setSettings(indexSetting);
  index.search(querySearch, function (err, content) {
    if (err) throw err;
    // console.log('CONTENT ==> ', content.hits);  
    console.log('TOTAL ==> ', content.hits.length);      
    res.status(200).send(content);

  });


})
// Delete a listing 
app.delete('/listings/:listingId', (req, res) => {
  firebaseHelper.firestore
  .deleteDocument(db, listingsCollection, req.params.listingId);

  const index = client.initIndex(ALGOLIA_INDEX_NAME);
  index.deleteObject(req.params.listingId);
  res.json({'msg': 'listing deleted'});
})





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

