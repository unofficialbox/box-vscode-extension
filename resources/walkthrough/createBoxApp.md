## Create a Box OAuth 2.0 Application

To connect the extension to Box, you need an OAuth 2.0 Custom App.

### Steps

1. Open the **[Box Developer Console](https://app.box.com/developers/console)**
2. Click **Create New App**
3. Select **Custom App**
4. Choose **User Authentication (OAuth 2.0)** as the authentication method
5. Give your app a name and click **Create App**

### Configure the Redirect URI

1. In your app's **Configuration** tab, scroll to **OAuth 2.0 Redirect URI**
2. Set the redirect URI to:

```
http://localhost:3000/callback
```

3. Click **Save Changes**

### Copy Your Credentials

You will need the following values for the authorization wizard:

- **Client ID** — found at the top of the Configuration tab
- **Client Secret** — click **Fetch Client Secret** to reveal it

> Keep these credentials secure. They are stored in VS Code's encrypted secrets storage and never written to disk.
