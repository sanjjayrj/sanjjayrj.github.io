var canvas = document.getElementById("myCanvas");
var ctx = canvas.getContext("2d");
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// Particle settings
let particleArray = [];
let adjustX = 5; // Horizontal offset for text
let adjustY = 5; // Vertical offset for text

// Mouse object to track mouse position
const mouse = {
    x: null,
    y: null,
    radius: 150 // Radius of interaction
};

// Update mouse position on move
window.addEventListener("mousemove", function (event) {
    mouse.x = event.x;
    mouse.y = event.y;
});

// Handle window resize
window.addEventListener("resize", function () {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    init(); // Re-initialize particles
});

// Create particles based on text
ctx.fillStyle = "white";
ctx.font = "30px Arial"; // Font size and family
ctx.fillText("Welcome to Sanjay's Portfolio", 20, 50); // Customize your text here
const textCoordinates = ctx.getImageData(0, 0, canvas.width, canvas.height);

// Particle blueprint
class Particle {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.size = 2; // Particle size
        this.baseX = this.x;
        this.baseY = this.y;
        this.density = (Math.random() * 15) + 1;
    }

    draw() {
        ctx.fillStyle = "coral"; // Particle color
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.closePath();
        ctx.fill();
    }

    update() {
        let dx = mouse.x - this.x;
        let dy = mouse.y - this.y;
        let distance = Math.sqrt(dx * dx + dy * dy);
        let forceDirectionX = dx / distance;
        let forceDirectionY = dy / distance;
        let maxDistance = mouse.radius;
        let force = (maxDistance - distance) / maxDistance;

        if (distance < mouse.radius) {
            this.x -= forceDirectionX * force * this.density;
            this.y -= forceDirectionY * force * this.density;
        } else {
            // Reset position if particle moves out of radius
            if (this.x !== this.baseX) {
                let dx = this.x - this.baseX;
                this.x -= dx / 5;
            }
            if (this.y !== this.baseY) {
                let dy = this.y - this.baseY;
                this.y -= dy / 5;
            }
        }
    }
}

// Initialize particle array
function init() {
    particleArray = [];
    for (let y = 0, y2 = textCoordinates.height; y < y2; y++) {
        for (let x = 0, x2 = textCoordinates.width; x < x2; x++) {
            if (textCoordinates.data[(y * 4 * textCoordinates.width) + (x * 4) + 3] > 128) {
                let positionX = x + adjustX;
                let positionY = y + adjustY;
                particleArray.push(new Particle(positionX * 2, positionY * 2));
            }
        }
    }
}

// Animation loop
function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < particleArray.length; i++) {
        particleArray[i].draw();
        particleArray[i].update();
    }
    requestAnimationFrame(animate);
}

init();
animate();
