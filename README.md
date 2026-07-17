# Sapucaia - Gestão de Gado

A lightweight, robust Progressive Web App (PWA) for managing cattle and pastures on the farm. Sapucaia is built for field conditions, offering full offline capabilities so employees can record cattle counts, pasture conditions, and photos even without an internet connection.

## 🚀 Key Features

The system supports two user profiles: **Admin** and **Parceiro** (Partner/Employee).

### Admin Dashboard
* **Global Overview:** See total cattle numbers across all farms.
* **Property Management:** Create, rename, and delete farms (fazendas) and pastures (pastos).
* **Access Control:** Generate and manage access passwords for field partners, restricting their access to specific farms.
* **Comprehensive Reporting:** View consolidated cattle counts broken down by age and sex, read pasture notes, and view photos.
* **History Log:** Track the movement history of cattle across pastures over time.
* **Backup & Restore:** Export/import the full database as a JSON file, or create and restore snapshots stored in the cloud (Firestore).

### Partner Field App (Mobile-First)
* **Offline First:** Fully functional without an internet connection. Changes sync automatically when the signal is restored.
* **Streamlined UI:** Large, high-contrast buttons and easy-to-read badges designed for outdoor use under direct sunlight.
* **Detailed Inventory:** Update cattle counts grouped by sex (Male/Female) and age ranges.
* **Pasture Health:** Add notes and upload photos (camera or gallery) of the pasture conditions.

## 🛠️ Technologies & Dependencies

* **Frontend:** HTML5, CSS3 (Vanilla, Mobile-First), JavaScript (ES6+). No build step and no framework.
* **Backend & Database:** Firebase Cloud Firestore (NoSQL) with offline persistence explicitly enabled.
* **File Storage:** Firebase Storage for pasture photos, with an automatic fallback to storing compressed images directly in Firestore when Storage is unreachable.
* **PWA:** `manifest.json` and a Service Worker (`sw.js`) for installability and asset caching.
* **Dependencies:** None! It's a pure front-end application using the Firebase SDK via CDN.

## 📋 Prerequisites

To run this project, you will need:

1. A **Firebase Project** with Firestore and Storage enabled.
2. A **Web Server** (like Live Server, http-server, or Firebase Hosting) to serve the files, as Service Workers and PWA features require an `http://localhost` or an `https://` connection. Opening `index.html` directly from the filesystem (`file://`) will not work.

## ⚙️ Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/sapucaia.git
   cd sapucaia
   ```

2. **Configure Firebase:**
   Open `app.js` and replace the `firebaseConfig` object with your own Firebase project credentials:
   ```javascript
   const firebaseConfig = {
     apiKey: "YOUR_API_KEY",
     authDomain: "YOUR_AUTH_DOMAIN",
     projectId: "YOUR_PROJECT_ID",
     storageBucket: "YOUR_STORAGE_BUCKET",
     messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
     appId: "YOUR_APP_ID"
   };
   ```

3. **PWA Icons:**
   The app ships with `icon.png` (512×512) and `icon_192x192.png` (192×192) in the project root, referenced by `manifest.json`. Replace these with your own to customize the "Add to Home Screen" icon.

4. **Run the Application:**
   Start a local web server in the project directory. For example, using Node.js `npx`:
   ```bash
   npx http-server .
   ```
   Access the application in your browser at `http://localhost:8080`.

## 🔄 PWA Updates & Caching

Because Sapucaia is a Progressive Web App, it aggressively caches assets to allow offline usage in the field. When you push new code updates to your hosting provider, the changes might not immediately appear in the browser.

To ensure your users always get the latest version, before deploying:
1. **Update `sw.js`:** Bump the `CACHE_NAME` constant (e.g. from `sapucaia-cache-v1` to `sapucaia-cache-v2`). The Service Worker automatically deletes old cache versions when a new version is detected.
2. **Update the version badge:** Bump the visible version badge (e.g. `v14`) in `index.html` so the deployed version is identifiable on-device.
3. **In-app refresh:** Users can force the latest version via the **🔄 Atualizar** menu item, which unregisters the Service Worker, clears all caches, and reloads.
4. **Hard Refresh:** When testing a deployment, a hard refresh (`Ctrl + F5` / `Cmd + Shift + R`) forces the browser to fetch the new Service Worker from the network.

## 📤 Sharing & Transferring the App (Independent Instance)

To transfer this app to another farmer so they can manage their own cattle with a separate, private database:

### 1. Send the Source Code
Zip and send the following files to the new farm owner:
* `index.html`
* `styles.css`
* `app.js`
* `manifest.json`
* `sw.js`
* `icon.png` and `icon_192x192.png`

### 2. Set Up a Firebase Backend
They will need their own Firebase project to store data and pasture photos:
1. Go to the [Firebase Console](https://console.firebase.google.com/) and create a new project.
2. Register a new **Web App** in the project to obtain the `firebaseConfig` object.
3. **Firestore Database:**
   * Create a Cloud Firestore database.
   * In the **Rules** tab, apply these rules:
     ```javascript
     rules_version = '2';
     service cloud.firestore {
       match /databases/{database}/documents {
         match /fazenda/state {
           allow read, write: if true;
         }
         match /pasturePhotos/{photoId} {
           allow read, write: if true;
         }
         match /backups/{backupId} {
           allow read, write: if true;
         }
       }
     }
     ```
4. **Firebase Storage:**
   * Enable Storage.
   * In the **Rules** tab, apply these rules:
     ```javascript
     rules_version = '2';
     service firebase.storage {
       match /b/{bucket}/o {
         match /pasture-photos/{allPaths=**} {
           allow read, write: if true;
         }
       }
     }
     ```

> ⚠️ **Security note:** These rules allow public read/write and access passwords are stored in plaintext. This is a deliberately simple model intended for low-risk, single-tenant field use. Do not store sensitive data, and consider tightening the rules if the database is exposed publicly.

### 3. Configure the Credentials

Open `app.js` and replace the existing `firebaseConfig` constant with the credentials from the new Web App.

### 4. Deploy the Frontend

Host the static files on a web server with SSL (`https://`), which is required for PWA installation. Free options include GitHub Pages, Netlify, Vercel, or Firebase Hosting.

### 5. Initialize the App

1. Access the hosted URL. The application automatically initializes a blank database when it detects that no state exists.
2. Log in using the default admin password: `admin`.
3. Open the menu, change the password, and start adding farms and pastures.

## 📖 How to Use

### 1. Initial Setup (Admin)

1. Open the app and log in using the default admin password (`admin`).
2. Navigate to "Gerenciar Fazendas e Pastos" to add your first farm.
3. Click "+ Adicionar Pasto" to add pastures to the new farm.
4. Go to "Acesso dos Parceiros" and create a password for your employee, linking them to the newly created farm.

### 2. Field Work (Partner)

1. The partner logs in on their mobile device using the password created by the Admin.
2. **Offline Use:** The partner can lose signal or enable airplane mode — the app keeps loading and functioning thanks to the Service Worker cache.
3. They select the farm and pasture, then click "Carregar Animais".
4. They increment or decrement cattle counts using the `+` and `-` buttons (or type a value directly), and can add notes and photos.
5. Once back online, all changes sync instantly to Firebase and become visible to the Admin.
