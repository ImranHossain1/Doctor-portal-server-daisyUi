const express = require('express')
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
var nodemailer = require('nodemailer');
var sgTransport = require('nodemailer-sendgrid-transport');
const { MongoClient, ServerApiVersion } = require('mongodb');
const app = express()
const port = process.env.PORT || 5000

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.f9yvm.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyJWT(req, res, next){
  const authHeader = req.headers.authorization;
  if(!authHeader){
    return res.status(401).send({message: 'Unauthorized Access'})
  }
  const token = authHeader.split(' ')[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function(err, decoded) {
    if(err){
      return res.status(403).send({message:"Forbidden Access"})
    }
    req.decoded= decoded;
    next();
  });
}

  const emailSenderOptions = {
    auth: {
      api_key: process.env.EMAIL_SENDER_KEY
    }
  }
  const emailClient = nodemailer.createTransport(sgTransport(emailSenderOptions));

function sendAppointmentEmail(booking){
  const {patient, patientName, treatment, date, slot} = booking;
  var email = {
    from: process.env.EMAIL_SENDER,
    to: patient,
    subject: `Your Appointment for ${treatment} is on ${date} at ${slot} is confirmed`,
    text: `Your Appointment for ${treatment} is on ${date} at ${slot} is confirmed`,
    html: `
      <div>
        <h1>Hello ${patientName}</h1>
        <h3>Your Appointment for ${treatment} is Confirmed</h3>
        <p>Looking Forword to see you on ${date} ar ${slot}</p>
        <h3>Our Address</h3>
        <p>Ginnheimer Landstr 42</p>
        <p>Frankfurt Am Main</p>
        <p>Germany</p>
        <a href="https://www.facebook.com/imran1402/">Unsubscribe</a>
      </div>`
  };
  emailClient.sendMail(email, function(err, info){
    if (err ){
      console.log(err);
    }
    else {
      console.log('Message sent: ' , info);
    }
  });
}


async function run(){
    try{
        await client.connect();
        const serviceCollection = client.db('doctors_portal').collection('services')
        const bookingCollection = client.db('doctors_portal').collection('booking')
        const userCollection = client.db('doctors_portal').collection('users')
        const doctorCollection = client.db('doctors_portal').collection('doctors');

        const verifyAdmin = async(req, res, next)=>{
          const requester = req.decoded.email;
          const requesterAccount = await userCollection.findOne({email: requester})
          if(requesterAccount.role==='admin'){
            next();
          }
          else{
            return res.status(403).send({message: 'Forbidden Access'});
          }
        }
        /* API naming Convention*/
        /*
          * app.get('/booking') //get all bookings in this collection. or get more than one or by filter
          * app.get('/booking/:id') //get a specific booking
          * app.post('/booking') // add a new booking
          * app.patch('/booking/:id')//
          * app.delete(/booking/:id)//
        */
        app.get('/service', async(req,res)=>{
            const query = {};
            const cursor= serviceCollection.find(query).project({name:1});
            const services= await cursor.toArray();
            res.send(services);
        });

         app.get('/available', async(req,res)=>{
          const date = req.query.date;
          //step1: get all services
          const services = await serviceCollection.find().toArray();
          //step2: get the booking of that day
          const query = {date: date};
          const bookings = await bookingCollection.find(query).toArray();

          //step 3: for each service, find booking for that service
          services.forEach(service =>{
            const serviceBookings= bookings.filter(book=> book.treatment  === service.name);
            const bookedSlots = serviceBookings.map(book=> book.slot);

            service.slots = service.slots.filter(slot=> !bookedSlots.includes(slot));
            // service.booked = booked
            //service.booked = serviceBookings.map(s=> s.slot);
          })
          res.send(services)
        }) 

        app.get('/booking',verifyJWT, async(req,res)=>{
          const patient = req.query.patient;
          const decodedEmail = req.decoded.email;
          if(patient === decodedEmail){
            const query = {patient: patient};
            const bookings = await bookingCollection.find(query).toArray();
            return res.send(bookings);
          }
          else{
            return res.status(403).send({message: 'Forbidden Access'});
          }
         
        })
        app.get('/user',verifyJWT, async (req, res) => {
          const users = await userCollection.find().toArray();
          res.send(users);
        });
        app.get('/admin/:email', async(req,res)=>{
          const email = req.params.email;
          const user = await userCollection.findOne({email:email})
          const isAdmin = user.role ==='admin';
          res.send({admin: isAdmin});
        })
        app.put('/user/admin/:email',verifyJWT,verifyAdmin, async(req,res)=>{
          const email = req.params.email;
            const filter = {email: email};
            const updateDoc = {
              $set: {role: 'admin'},
            };
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send({result});          
        })

        app.put('/user/:email', async(req,res)=>{
          const email = req.params.email;
          const user = req.body;
          const filter = {email: email};
          const options = {upsert : true};
          const updateDoc = {
            $set: user,
          };
          const result = await userCollection.updateOne(filter, updateDoc,options);
          const token= jwt.sign({email: email}, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
          res.send({result, token});
        })

        app.post('/booking',async(req,res)=>{
          const booking = req.body;
          const query = {treatment: booking.treatment,date: booking.date, patient: booking.patient};
          const exists = await bookingCollection.findOne(query);
          if(exists){
            return res.send({success: false, booking: exists})
          }
          const result =await bookingCollection.insertOne(booking);
          sendAppointmentEmail(booking)
          return res.send({success: true ,result});
        })

        app.get('/doctor', verifyJWT, verifyAdmin, async(req, res)=>{
          const doctors = await doctorCollection.find().toArray();
          res.send(doctors);
        })

        app.post('/doctor', verifyJWT, verifyAdmin, async(req,res)=>{
          const doctor = req.body;
          const result = await doctorCollection.insertOne(doctor);
          res.send(result);
        })
        app.delete('/doctor/:email', verifyJWT, verifyAdmin, async(req,res)=>{
          const email = req.params.email;
          const filter = {email: email}
          const result = await doctorCollection.deleteOne(filter);
          res.send(result);
        })


    }
    finally{

    }
}
run().catch(console.dir)
app.get('/', (req, res) => {
  res.send('Hello from Doctor Uncle!')
})

app.listen(port, () => {
  console.log(`Doctors app listening on port ${port}`)
})