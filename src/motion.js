(function (global) {

    var getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;

    var settings = {
        framerate: 25,
        videoCompressionRate: 2,
        sensitivity: 82,	// value from 0 to 100 (100 => very sensitive)
        skinFilter: false,
        debug: {
            state: false,
            canvas: null,
            context: null
        }
    };

    var initialised = false,
        started = false;

    var stream;
    var video, canvas, context;

    function init() {
        initialised = true;

        video = document.createElement('video');
        canvas = document.createElement('canvas');

        if (!!video.canPlayType && !!(canvas.getContext && canvas.getContext('2d')) && !!getUserMedia) {

            video.width = 300;
            video.height = 225;

            video.setAttribute('style', 'visibility: hidden;');
            canvas.setAttribute('style', 'width: 300px; display: none;');

            document.body.appendChild(video);
            document.body.appendChild(canvas);
            context = canvas.getContext('2d');
        }

    }

    function start() {
        started = true;

        if (!initialised) {
            init();
        }

        if (!video || !(video.paused || video.ended || video.seeking || video.readyState < video.HAVE_FUTURE_DATA)) {
            // TODO
            return false;
        }

        getUserMedia.call(navigator,

            {
                audio: false,
                video: true
            },

            // successCallback
            function (_LocalMediaStream) {
                stream = _LocalMediaStream;

                window.URL = window.URL || window.webkitURL;
                video.src = window.URL.createObjectURL(stream);

                video.addEventListener('canplaythrough',
                    //play the video once it can play through
                    function () {
                        video.play();

                        video.addEventListener('playing',
                            function () {

                                var width = Math.floor(video.getBoundingClientRect().width / settings.videoCompressionRate),
                                    height = Math.floor(video.getBoundingClientRect().height / settings.videoCompressionRate);

                                //define canvas sizes
                                canvas.width = width;
                                canvas.height = height;

                                //capture frames on set intervals
                                setInterval(function () {
                                    grabVideoFrame(width, height);
                                }, 1000 / settings.framerate);
                            },
                            false
                        );
                    },
                    false
                );
            },

            function (error) {
                // TODO
            });

        return !!getUserMedia;
    }

    function stop() {
        if (!initialised || !started) {
            return false;
        }

        if (video) {
            video.src = '';
        }
        return !!stream.stop();
    }


    function grabVideoFrame(width, height) {
        // grab a frame from the video and compress it to the width/height specified - we do this by drawing it onto a temporary canvas
        try {
            // copy the get the current frame from the video and draw it (compressed) on the canvas
            context.drawImage(video, 0, 0, width, height);

            var currentFrame = context.getImageData(0, 0, width, height);

            //calculate the difference map
            if (settings.skinFilter) {
                differenceMap.get(skinFilter.apply(currentFrame), settings.sensitivity, width, height);
            } else {
                differenceMap.get(currentFrame, settings.sensitivity, width, height);
            }
        } catch (e) {
            if (e.name === "NS_ERROR_NOT_AVAILABLE") {
                // firefox isn't ready yet... hang tight, it'll kick in shortly
                return false;
            } else {
                throw e;
            }
        }
    }

    /**
     * skin filtering using HUE (colour) SATURATION (dominance of the colour) VALUE (brightness of the colour)
     * this algorithms reliability is heavily dependant on lighting conditions - see this journal article http://wwwsst.ums.edu.my/data/file/Su7YcHiV9AK5.pdf
     */
    var skinFilter = {
        //TODO: fine tune these values
        huemin: 0.0,
        huemax: 0.1,
        satmin: 0.3,
        satmax: 1.0,
        valmin: 0.4,
        valmax: 1.0,
        rgb2hsv: function (r, g, b) {
            r = r / 255;
            g = g / 255;
            b = b / 255;

            var max = Math.max(r, g, b),
                min = Math.min(r, g, b),

                h, s, v = max,

                d = max - min;

            if (max === 0) {
                s = 0;
            } else {
                s = d / max;
            }

            if (max == min) {
                h = 0; // achromatic
            } else {
                switch (max) {
                    case r:
                        h = (g - b) / d + (g < b ? 6 : 0);
                        break;
                    case g:
                        h = (b - r) / d + 2;
                        break;
                    case b:
                        h = (r - g) / d + 4;
                        break;
                    default:
                        break;
                }
                h /= 6;
            }

            return [h, s, v];
        },
        apply: function (currentFrame) {
            var totalPix = currentFrame.width * currentFrame.height,
                indexValue = totalPix * 4,
                countDataBigAry = 0;

            for (var y = 0; y < currentFrame.height; y++) {
                for (var x = 0; x < currentFrame.width; x++) {
                    indexValue = x + y * currentFrame.width;
                    var r = currentFrame.data[countDataBigAry],
                        g = currentFrame.data[countDataBigAry + 1],
                        b = currentFrame.data[countDataBigAry + 2],
                        a = currentFrame.data[countDataBigAry + 3],

                        hsv = this.rgb2hsv(r, g, b);

                    //when the hand is too close (hsv[0] > 0.59 && hsv[0] < 1.0)
                    //skin range on HSV values
                    if (( (hsv[0] > this.huemin && hsv[0] < this.huemax) || (hsv[0] > 0.59 && hsv[0] < 1.0) ) && (hsv[1] > this.satmin && hsv[1] < this.satmax) && (hsv[2] > this.valmin && hsv[2] < this.valmax)) {
                        currentFrame[countDataBigAry] = r;
                        currentFrame[countDataBigAry + 1] = g;
                        currentFrame[countDataBigAry + 2] = b;
                        currentFrame[countDataBigAry + 3] = a;
                    } else {
                        currentFrame.data[countDataBigAry] = 255;
                        currentFrame.data[countDataBigAry + 1] = 255;
                        currentFrame.data[countDataBigAry + 2] = 255;
                        currentFrame.data[countDataBigAry + 3] = 0;
                    }
                    countDataBigAry = indexValue * 4;
                }
            }
            return currentFrame;
        }
    };

    /* @private */
    var differenceMap = {
        priorFrame: false,

        get: function (currentFrame, sensitivity, width, height) {
            var delt = context.createImageData(width, height),
                totalx = 0,
                totaly = 0,
                totald = 0; //total number of changed pixels

            if (this.priorFrame !== false) {
                var totaln = delt.width * delt.height,
                    pix = totaln * 4,
                    maxAssessableColorChange = 256 * 3;

                while ((pix -= 4) >= 0) {
                    //find the total change in color for this pixel-set
                    var d = Math.abs(currentFrame.data[pix] - this.priorFrame.data[pix]) +
                        Math.abs(currentFrame.data[pix + 1] - this.priorFrame.data[pix + 1]) +
                        Math.abs(currentFrame.data[pix + 2] - this.priorFrame.data[pix + 2]); //don't do [pix+3] because alpha doesn't change

                    if (d > maxAssessableColorChange * Math.abs((sensitivity - 100) / 100)) {
                        //if there has been significant change in color, mark the changed pixel
                        delt.data[pix] = 255;	//R
                        delt.data[pix + 1] = 0;	//G
                        delt.data[pix + 2] = 0;	//B
                        delt.data[pix + 3] = 255;	//alpha
                        totald += 1;
                        totalx += ((pix / 4) % delt.width);
                        totaly += (Math.floor((pix / 4) / delt.height));
                    } else {
                        //otherwise keep it the same color
                        delt.data[pix] = currentFrame.data[pix];
                        delt.data[pix + 1] = currentFrame.data[pix + 1];
                        delt.data[pix + 2] = currentFrame.data[pix + 2];
                        delt.data[pix + 3] = currentFrame.data[pix + 3]; //change to 0 to hide user video
                    }
                }
            }

            //console.log(totald);
            if (totald > 0) {
                //if any pixels have changed, check for a gesture
                lookForGesture.search({x: totalx, y: totaly, d: totald});

                //show in debug canvas
                if (settings.debug.state && settings.debug.context.putImageData) {
                    settings.debug.canvas.width = width;
                    settings.debug.canvas.height = height;
                    settings.debug.context.putImageData(delt, 0, 0);
                }
            }
            this.priorFrame = currentFrame;
        }
    };

    function debounce(func, threshold, execAsap){
        var timeout;
        if (false !== execAsap) execAsap = true;

        return function debounced(){
            var obj = this, args = arguments;

            function delayed () {
                if (!execAsap) {
                    func.apply(obj, args);
                }
                timeout = null;
            }

            if (timeout) {
                clearTimeout(timeout);
            } else if (execAsap) {
                func.apply(obj, args);
            }

            timeout = setTimeout(delayed, threshold || 100);
        };
    }

    var dispatchMotionEvent = function (event) {
        var evt = document.createEvent('Event');
        evt.initEvent('motion', true, true);
        evt.direction = event.direction;
        document.dispatchEvent(evt);
    };

    var lookForGesture = {
        prior: false,
        filteringFactor: 0.9,
        filteredTotal: 0,		//number of changed pixel after filtering
        minTotalChange: 200,	//minimum total number of pixels that need to change, before we decide that a gesture is happening
        minDirChange: 2,		//minimum number of pixels that need to change to assert a directional change
        longDirChange: 7,		//minimum number of pixels that need to change to assert a LONG directional change
        state: 0,				//States: 0 waiting for gesture, 1 waiting for next move after gesture, 2 waiting for gesture to end
        search: function (_movement) {
            var movement = {
                x: _movement.x / _movement.d,
                y: _movement.y / _movement.d,
                d: _movement.d //delta (or total change)
            };

            //filtering
            this.filteredTotal = (this.filteringFactor * this.filteredTotal) + ((1 - this.filteringFactor) * movement.d);

            var dfilteredTotal = movement.d - this.filteredTotal,
                good = dfilteredTotal > this.minTotalChange; //check that total pixel change is grater than threshold

            // console.log(good, dfilteredTotal);
            switch (this.state) {
                case 0:
                    if (good) {
                        //found a gesture, waiting for next move
                        this.state = 1;
                        lookForGesture.prior = movement;
                    }
                    break;

                case 1:
                    //got next move, do something based on direction
                    this.state = 2;

                    var dx = movement.x - lookForGesture.prior.x,
                        dy = movement.y - lookForGesture.prior.y,

                        dirx = Math.abs(dy) < Math.abs(dx); //(dx,dy) is on a bowtie

                    // console.log(dirx, dx, dy);
                    if (dx < -this.minDirChange && dirx) {
                        dispatchMotionEvent({
                            direction: 'right'
                        });
                    } else if (dx > this.minDirChange && dirx) {
                        dispatchMotionEvent({
                            direction: 'left'
                        });
                    }

                    if (dy > this.minDirChange && !dirx) {
                        if (Math.abs(dy) > this.longDirChange) {
                            dispatchMotionEvent({
                                direction: 'downlong'
                            });
                        } else {
                            dispatchMotionEvent({
                                direction: 'down'
                            });
                        }
                    } else if (dy < -this.minDirChange && !dirx) {
                        if (Math.abs(dy) > this.longDirChange) {
                            dispatchMotionEvent({
                                direction: 'uplong'
                            });
                        } else {
                            dispatchMotionEvent({
                                direction: 'Up'
                            });
                        }
                    }
                    break;

                case 2:
                    // wait for gesture to end
                    if (!good) {
                        this.state = 0; // gesture ended
                    }
                    break;

                default:
                    break;
            }
        }
    };

    function debug(){
        settings.debug.state = true;

        // for visualising the diff map
        settings.debug.canvas = document.createElement('canvas');
        settings.debug.canvas.setAttribute('style', 'width: 300px; height: 225px; position: fixed; bottom: 0; right: 0;');
        document.body.appendChild(settings.debug.canvas);
        settings.debug.context = settings.debug.canvas.getContext('2d');

    }

    global.motion = {
        start: start,
        stop: stop,
        debug: debug
    };

    if(global.__startMotion || location.href.indexOf('start-motion') > -1){
        start();
    }

    if(global.__debugMotion || location.href.indexOf('debug-motion') > -1){
        debug();
    }

})(this);