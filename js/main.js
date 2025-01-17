// Fetch data and populate projects and blogs
async function loadData() {
    try
    {
        const projectResponse = await fetch('projects.json');
        const blogResponse = await fetch('blogs.json');

        if (!projectResponse.ok || !blogResponse.ok) {
            console.error("Failed to load JSON data");
            return;
        }

        const projects = await projectResponse.json();
        const blogs = await blogResponse.json();

        console.log("Projects Data:", projects);
        console.log("Blogs Data:", blogs);

        populateProjects(projects);
        populateBlogs(blogs);
    }
    catch (error)
    {
        console.error("Error loading JSON files: ", error);
    }
}

function populateProjects(projects) {
    const projectList = document.getElementById('project-list');
    if (projects.length === 0) {
        projectList.innerHTML = `
            <div class="card">
                <h3>Sample Project</h3>
                <p>This is a placeholder for project details.</p>
                <a href="#">View Details</a>
            </div>
        `;
        return;
    }

    projects.forEach((project) => {
        const projectCard = `
            <div class="card" onclick="window.location.href='${project.link}'">
                <img src="#" alt="Project Image Placeholder">
                <h3>${project.title}</h3>
                <p>${project.description}</p>
                <a href="${project.link}">View Details</a>
            </div>
        `;
        projectList.innerHTML += projectCard;
    });
}

function populateBlogs(blogs) {
    const blogList = document.getElementById('blog-list');
    if (blogs.length === 0) {
        blogList.innerHTML = `
            <div class="card">
                <h3>Sample Blog</h3>
                <p>This is a placeholder for blog details.</p>
                <a href="#">Read More</a>
            </div>
        `;
        return;
    }

    blogs.forEach((blog) => {
        const blogCard = `
            <div class="card" onclick="window.location.href='${blog.link}'">
                <img src="#" alt="Blog Image Placeholder">
                <h3>${blog.title}</h3>
                <p>${blog.snippet}</p>
                <a href="${blog.link}">Read More</a>
            </div>
        `;
        blogList.innerHTML += blogCard;
    });
}

let lastScrollTop = 0;
const navbar = document.querySelector('header nav');

window.addEventListener('scroll', () => {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    if (scrollTop > lastScrollTop) {
        // Scrolling down
        navbar.classList.add('nav-hidden');
    } else {
        // Scrolling up
        navbar.classList.remove('nav-hidden');
    }
    lastScrollTop = scrollTop <= 0 ? 0 : scrollTop; // Avoid negative scroll values
});
loadData();