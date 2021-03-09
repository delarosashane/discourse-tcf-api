import { withPluginApi } from 'discourse/lib/plugin-api';

export default {
  name: 'with-plugin-sample',
  initialize() {

     withPluginApi('0.1', api => {       
       api.onPageChange(() => console.log('user navigated!'));
     });

  }
}