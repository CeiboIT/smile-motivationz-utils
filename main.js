var Hapi = require('hapi');

var internals = {};

internals.get = function (request, reply) {
    reply('Success!\n');
};

var server = new Hapi.Server(~~process.env.PORT || 8000, '0.0.0.0',  { cors: true });

server.route([
	{ method: 'GET', path: '/', config: { handler: internals.get } }
]);

var conf = require('./optin.conf'),
    Firebase = require('firebase'),
    mandrill = require('mandrill-api/mandrill'),
    cloudinary = require('cloudinary');

cloudinary.config(conf.cloudinary);

//Log catcher setup
var firebaseRef = new Firebase(conf.firebase.url);

var emailClient = new mandrill.Mandrill(conf.mandrill.key);

//Firebase Auth
firebaseRef.authWithCustomToken(conf.firebase.secret, function(error) {
    //Auth Failed
    if (error) {
        console.log(error);
    } else {
        console.log('here listening');
        // New Optin Queued
        firebaseRef.child(conf.firebase.queue).on('child_added', function(optinSnapshot) {
            var optinData = optinSnapshot.val();
            var optinLocation = conf.firebase.url + conf.firebase.queue + '/' + optinSnapshot.key();
            var optinRef = new Firebase(optinLocation);
            var emailDomain = '';
            if(optinData.email) {
                emailDomain = optinData.email.slice(optinData.email.lastIndexOf('@') + 1);
            }
            else {
                emailDomain = 'forbidden.com';
            }

            var newPassword = Math.random().toString(36).slice(-8);
            firebaseRef.createUser({
                email: optinData.email,
                password: newPassword
            }, function(error, userData) {
                if (error) {
                    optinRef.remove(function(error) {
                        if (error) {
                            console.log(error);
                        }
                    });
                } else {
                    firebaseRef.child('users').child(userData.uid).set({
                        email: optinData.email,
                        role: 'customer',
                        registered: false
                    }, function(error) {
                        if(!error) {
                            var email = {
                                to: [{
                                    email: optinData.email
                                }],
                                merge_language: 'handlebars',
                                'global_merge_vars': [{
                                    name: 'email',
                                    content: optinData.email
                                }, {
                                    name: 'password',
                                    content: newPassword
                                }]

                            };
                        }

                        emailClient.messages.sendTemplate({
                            template_name: conf.mandrill.template,
                            template_content: {},
                            message: email,
                            async: false
                        }, function(result) {
                            if (result[0].status === 'sent' || result[0].status === 'queued') {
                                optinRef.remove(function(error) {
                                    if (error) {
                                        //ravenClient.captureError(error);
                                    }
                                });
                            }
                        });

                    });

                }
            });

            //Auth Lost
        });

        // New cleanUp Queued
        firebaseRef.child('jobs').child(conf.firebase.cleanUp).on('child_added', function(cleanUpSnapshot) {
            var cleanUpId = cleanUpSnapshot.val();
            var cleanUpLocation = conf.firebase.url + 'jobs/' + conf.firebase.cleanUp + '/' + cleanUpSnapshot.key();
            cloudinary.uploader.destroy(cleanUpId, function(res) {
                if (res.result === 'ok') {
                    var cleanUpref = new Firebase(cleanUpLocation);
                    cleanUpref.remove(function(error) {
                        if (error) {
                           console.log(error);
                        }
                    });
                }
            });
        });

    }
});

server.start(function () {
    console.log('Server started at [' + server.info.uri + ']');
});
