window.player = {
    audio: new Audio(),
    dotNetRef: null,
    audioContext: null,
    analyser: null,
    source: null,
    canvas: null,
    canvasCtx: null,

    initialize: function (dotNetReference) {
        this.dotNetRef = dotNetReference;

        // Basic Event Listeners
        this.audio.addEventListener('timeupdate', () => {
            if (this.dotNetRef) {
                this.dotNetRef.invokeMethodAsync('OnTimeUpdate', this.audio.currentTime, this.audio.duration);
            }
        });

        this.audio.addEventListener('ended', () => {
            if (this.dotNetRef) this.dotNetRef.invokeMethodAsync('OnTrackEnded');
        });

        // Initialize Context on interaction
        document.addEventListener('click', () => {
            if (!this.audioContext) {
                this.initAudioContext();
            }
        }, { once: true });
    },

    initAudioContext: function () {
        if (this.audioContext) return;

        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.audioContext = new AudioContext();

        if (!this.source) {
            this.source = this.audioContext.createMediaElementSource(this.audio);
        }

        // EQ Filters (10 Bands)
        const frequencies = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
        this.eqFilters = frequencies.map(freq => {
            const filter = this.audioContext.createBiquadFilter();
            filter.type = 'peaking';
            filter.frequency.value = freq;
            filter.Q.value = 1;
            filter.gain.value = 0;
            return filter;
        });

        // Analyser
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 512;
        this.analyser.smoothingTimeConstant = 0.8;

        // Connect Chain: Source -> Filters -> Analyser -> Destination
        let prevNode = this.source;
        this.eqFilters.forEach(filter => {
            prevNode.connect(filter);
            prevNode = filter;
        });

        prevNode.connect(this.analyser);
        this.analyser.connect(this.audioContext.destination);
    },

    setEqGain: function (index, gainDb) {
        if (this.eqFilters && this.eqFilters[index]) {
            this.eqFilters[index].gain.value = gainDb;
        }
    },

    initVisualizer: function (canvasElement) {
        this.canvas = canvasElement;
        this.canvasCtx = this.canvas.getContext('2d');
        this.drawVisualizer();
    },

    drawVisualizer: function () {
        if (!this.analyser || !this.canvas) {
            requestAnimationFrame(() => this.drawVisualizer());
            return;
        }
        requestAnimationFrame(() => this.drawVisualizer());

        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        this.analyser.getByteFrequencyData(dataArray);

        const width = this.canvas.width;
        const height = this.canvas.height;
        this.canvasCtx.clearRect(0, 0, width, height);

        const barWidth = (width / bufferLength) * 2.2;
        let barHeight;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            barHeight = dataArray[i] / 2.2;

            const style = getComputedStyle(document.body);
            const color = style.getPropertyValue('--visualizer-color').trim() || 'rgba(255,255,255,0.8)';

            this.canvasCtx.fillStyle = color;
            this.canvasCtx.fillRect(x, height - barHeight, barWidth, barHeight);

            x += barWidth + 1;
        }
    },

    play: function () {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
        this.audio.play();
    },

    pause: function () {
        this.audio.pause();
    },

    setVolume: function (value) {
        this.audio.volume = value / 100;
    },

    seek: function (time) {
        if (Number.isFinite(time))
            this.audio.currentTime = time;
    },

    // Drag & Drop Handling
    initDragDrop: function (element) {
        if (!element) element = document.body;

        element.addEventListener('dragover', e => {
            e.preventDefault();
            element.classList.add('drag-active');
        });

        element.addEventListener('dragleave', e => {
            element.classList.remove('drag-active');
        });

        element.addEventListener('drop', async e => {
            e.preventDefault();
            element.classList.remove('drag-active');

            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                const files = Array.from(e.dataTransfer.files);
                if (files.length > 0) {
                    const first = files[0];
                    const blob = new Blob([first], { type: first.type });
                    const url = URL.createObjectURL(blob);

                    this.readMetadata(blob);
                    this.audio.src = url;
                    this.audio.play();

                    if (this.dotNetRef) {
                        await this.dotNetRef.invokeMethodAsync('OnTrackDropped', first.name, url);
                    }
                }
            }
        });
    },

    initShortcuts: function (dotNetRef) {
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            switch (e.code) {
                case 'Space':
                    e.preventDefault();
                    dotNetRef.invokeMethodAsync('TogglePlay');
                    break;
                case 'ArrowRight':
                    if (e.ctrlKey) dotNetRef.invokeMethodAsync('NextTrack');
                    else dotNetRef.invokeMethodAsync('SeekRelative', 10);
                    break;
                case 'ArrowLeft':
                    if (e.ctrlKey) dotNetRef.invokeMethodAsync('PrevTrack');
                    else dotNetRef.invokeMethodAsync('SeekRelative', -10);
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    dotNetRef.invokeMethodAsync('VolumeRelative', 5);
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    dotNetRef.invokeMethodAsync('VolumeRelative', -5);
                    break;
                case 'KeyM':
                    dotNetRef.invokeMethodAsync('ToggleMute');
                    break;
            }
        });
    },

    playFromStream: async function (contentStreamReference) {
        const arrayBuffer = await contentStreamReference.arrayBuffer();
        const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
        const url = URL.createObjectURL(blob);

        this.audio.src = url;
        this.audio.play();

        this.readMetadata(blob);
    },

    readMetadata: function (blob) {
        const self = this;
        window.jsmediatags.read(blob, {
            onSuccess: function (tag) {
                let image = null;
                const tags = tag.tags;

                if (tags.picture) {
                    let base64String = "";
                    for (let i = 0; i < tags.picture.data.length; i++) {
                        base64String += String.fromCharCode(tags.picture.data[i]);
                    }
                    image = "data:" + tags.picture.format + ";base64," + window.btoa(base64String);
                }

                if (self.dotNetRef) {
                    self.dotNetRef.invokeMethodAsync('OnMetadataRead',
                        tags.title,
                        tags.artist,
                        image,
                        tags.album,
                        tags.year ? tags.year.toString() : "",
                        tags.genre
                    );
                }
            },
            onError: function (error) {
                console.log(error);
            }
        });
    }
};
