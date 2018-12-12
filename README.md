# Mockup 
webApi.get('api/v1/listings')
webApi.post('api/v1/listings').form({listing_type:'rent',property_type:'house',province:'battambang',district:'banon',title:'house in battambang for rent',price:'100',description:'good house near rongvol soul preap sor',bedrooms:'2',bathrooms:'3',size:'44 house',phone1:'012221221',phone2:'023443443',images:[],address:'road no 5',lat:'',lng:'',email:'',user_id:'',thumb:'thumbnail',user_name:'den cambodia', status: 1})

webApi.post('api/v1/listings').form({listing_type:'rent',property_type:'apartment',province:'phnom-penh',district:'toul-kok',title:'apartment in phnom penh for rent',price:'200',description:'good house near toulkok soul preap sor',bedrooms:'2',bathrooms:'3',size:'44 house',phone1:'012221221',phone2:'023443443',images:[],address:'road no 4',lat:'',lng:'',email:'',user_id:'',thumb:'thumbnail',user_name:'den cambodia', status: 1})

webApi.patch('api/v1/listings/eVKxeKii549fO9hndRuL').form({listing_type:'sell',property_type:'house',province:'preah-sihaknouk',district:'ocherteal',title:'house in KPS for sell',price:'10000',description:'good house near ocherteal soul preap sor',bedrooms:'2',bathrooms:'3',size:'44 house',phone1:'012221221',phone2:'023443443',images:[],address:'road no 3',lat:'',lng:'',email:'',user_id:'',thumb:'thumbnail',user_name:'den cambodia', status: 1})

webApi.post('api/v1/listings').form({listing_type:'sell',property_type:'land',province:'siem-reap',district:'angkor',title:'land in siem reap for sell',price:'20000',description:'good land near angkor soul preap sor',bedrooms:'2',bathrooms:'3',size:'44 house',phone1:'012221221',phone2:'023443443',images:[],address:'road no 2',lat:'',lng:'',email:'',user_id:'',thumb:'thumbnail',user_name:'den cambodia', status: 1})
