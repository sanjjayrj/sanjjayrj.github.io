// Fetch projects and blogs
async function fetchContent() {
    const projectResponse = await fetch('projects.json');
    const blogResponse = await fetch('blogs.json');
    const projects = await projectResponse.json();
    const blogs = await blogResponse.json();

    renderProjects(projects);
    renderBlogs(blogs);
}

// Render Projects
function renderProjects(projects) {
    const projectList = document.getElementById('project-list');
    projects.forEach(project => {
        projectList.innerHTML += `
            <div class="project-item">
                <img src="${project.image}" alt="${project.title}">
                <h3>${project.title}</h3>
                <p>${project.description}</p>
                <a href="${project.link}">View Project</a>
            </div>
        `;
    });
}

// Render Blogs
function renderBlogs(blogs) {
    const blogList = document.getElementById('blog-list');
    blogs.forEach(blog => {
        blogList.innerHTML += `
            <div class="blog-item">
                <h3>${blog.title}</h3>
                <p>${blog.snippet}</p>
                <a href="${blog.link}">Read More</a>
            </div>
        `;
    });
}

// Initialize
fetchContent();
