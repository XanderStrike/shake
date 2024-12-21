# Use the official Nginx image as the base image
FROM nginx:latest

# Copy all files from the current directory to the Nginx HTML directory
COPY . /usr/share/nginx/html

# Optionally download the demo if it's not already on the filesystem
RUN if [ ! -f /usr/share/nginx/html/linuxq3ademo-1.11-6.x86.gz.sh ]; then \
    apt-get update && apt-get install -y wget && \
    wget -O /usr/share/nginx/html/linuxq3ademo-1.11-6.x86.gz.sh https://archive.org/download/tucows_286139_Quake_III_Arena/linuxq3ademo-1.11-6.x86.gz.zip/linuxq3ademo-1.11-6.x86.gz.sh && \
    apt-get clean && rm -rf /var/lib/apt/lists/*; \
    fi

# Expose port 80 to allow external access
EXPOSE 80

# Start Nginx server
CMD ["nginx", "-g", "daemon off;"]
